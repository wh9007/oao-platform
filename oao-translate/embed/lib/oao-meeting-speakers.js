(function (global) {
    'use strict';

    const SPEAKER_COLORS = [
        '#1a56db', '#059669', '#c2410c', '#7c3aed',
        '#0891b2', '#ca8a04', '#db2777', '#4f46e5'
    ];
    const MAX_SPEAKERS = 8;
    const STORAGE_KEY = 'oao-meeting-speaker-names';
    const DEFAULT_SENSITIVITY = {
        vadRms: 0.007,
        matchDistance: 0.48,
        minSegmentSamples: 2400,
        minSpeechMs: 120,
        profileBlend: 0.35
    };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function vectorDistance(a, b) {
        let sum = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            const d = a[i] - b[i];
            sum += d * d;
        }
        return Math.sqrt(sum / len);
    }

    function blendVectors(base, next, weight) {
        const out = base.slice();
        const w = clamp(weight, 0.05, 0.65);
        for (let i = 0; i < out.length; i++) {
            out[i] = out[i] * (1 - w) + (next[i] || 0) * w;
        }
        return out;
    }

    function computeRms(samples) {
        if (!samples.length) return 0;
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }

    function computeZeroCrossRate(samples) {
        if (samples.length < 2) return 0;
        let crosses = 0;
        for (let i = 1; i < samples.length; i++) {
            if ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0)) {
                crosses += 1;
            }
        }
        return crosses / (samples.length - 1);
    }

    function estimatePitch(samples, sampleRate) {
        const minLag = Math.floor(sampleRate / 420);
        const maxLag = Math.floor(sampleRate / 70);
        if (samples.length <= maxLag + 2) return 0;
        let bestLag = 0;
        let bestCorr = 0;
        for (let lag = minLag; lag <= maxLag; lag++) {
            let corr = 0;
            const limit = samples.length - lag;
            for (let i = 0; i < limit; i++) {
                corr += samples[i] * samples[i + lag];
            }
            corr /= limit;
            if (corr > bestCorr) {
                bestCorr = corr;
                bestLag = lag;
            }
        }
        return bestLag ? sampleRate / bestLag : 0;
    }

    function computeSpectralShape(samples) {
        const size = 256;
        const bins = new Array(8).fill(0);
        const step = Math.max(1, Math.floor(samples.length / size));
        for (let b = 0; b < 8; b++) {
            let energy = 0;
            const start = Math.floor((b / 8) * size);
            const end = Math.floor(((b + 1) / 8) * size);
            for (let i = start; i < end; i++) {
                const idx = i * step;
                if (idx >= samples.length) break;
                const v = samples[idx];
                energy += v * v;
            }
            bins[b] = Math.sqrt(energy / Math.max(1, end - start));
        }
        const total = bins.reduce((acc, v) => acc + v, 0) || 1;
        return bins.map((v) => v / total);
    }

    function extractVoiceFingerprint(samples, sampleRate) {
        const rms = computeRms(samples);
        const zcr = computeZeroCrossRate(samples);
        const pitch = estimatePitch(samples, sampleRate);
        const pitchNorm = pitch ? clamp(pitch / 320, 0, 1) : 0;
        const spectral = computeSpectralShape(samples);
        const lowBand = (spectral[0] || 0) + (spectral[1] || 0);
        const midBand = (spectral[2] || 0) + (spectral[3] || 0) + (spectral[4] || 0);
        const highBand = (spectral[5] || 0) + (spectral[6] || 0) + (spectral[7] || 0);
        return [
            clamp(rms * 14, 0, 1),
            clamp(zcr * 8, 0, 1),
            pitchNorm,
            clamp(lowBand, 0, 1),
            clamp(midBand, 0, 1),
            clamp(highBand, 0, 1),
            spectral[0] || 0,
            spectral[3] || 0,
            spectral[6] || 0
        ];
    }

    function downsampleBuffer(input, inputRate, targetRate) {
        if (!input.length) return new Float32Array(0);
        if (inputRate === targetRate) return input.slice(0);
        const ratio = inputRate / targetRate;
        const length = Math.floor(input.length / ratio);
        const output = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            const pos = i * ratio;
            const idx = Math.floor(pos);
            const frac = pos - idx;
            const a = input[idx] || 0;
            const b = input[idx + 1] || a;
            output[i] = a + (b - a) * frac;
        }
        return output;
    }

    function escapeAttr(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    class OAOMeetingSpeakers {
        constructor(options) {
            options = options || {};
            this.onChange = typeof options.onChange === 'function' ? options.onChange : function () {};
            this.maxSpeakers = options.maxSpeakers || MAX_SPEAKERS;
            this.speakers = new Map();
            this.nextLetterIndex = 0;
            this.activeSpeakerId = null;
            this.manualSpeakerId = null;
            this.enabled = options.enabled !== false;
            this.processor = null;
            this.sourceNode = null;
            this.ctx = null;
            this.inputSampleRate = 44100;
            this.analysisRate = 16000;
            this.ring = new Float32Array(this.analysisRate * 4);
            this.ringWrite = 0;
            this.segment = [];
            this.inSpeech = false;
            this.speechMs = 0;
            this.lastActiveTs = 0;
            this.customNames = this.loadCustomNames();
            this.uiLang = 'zh';
            this.sensitivity = Object.assign({}, DEFAULT_SENSITIVITY);
        }

        setSensitivity(partial) {
            partial = partial || {};
            this.sensitivity = Object.assign({}, DEFAULT_SENSITIVITY, this.sensitivity, partial);
        }

        setLanguage(lang) {
            this.uiLang = lang === 'en' ? 'en' : 'zh';
        }

        get enabledSetting() {
            if (global.OAO_MEETING_SPEAKER_DIARIZATION === false) return false;
            return this.enabled;
        }

        loadCustomNames() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                return raw ? JSON.parse(raw) : {};
            } catch (_) {
                return {};
            }
        }

        saveCustomNames() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.customNames));
            } catch (_) {}
        }

        reset() {
            this.stopCapture();
            this.speakers.clear();
            this.nextLetterIndex = 0;
            this.activeSpeakerId = null;
            this.manualSpeakerId = null;
            this.ring.fill(0);
            this.ringWrite = 0;
            this.segment = [];
            this.inSpeech = false;
            this.speechMs = 0;
            this.onChange();
        }

        getSpeakerCount() {
            return this.speakers.size;
        }

        getColor(speakerId) {
            const sp = this.speakers.get(speakerId);
            return sp?.color || SPEAKER_COLORS[0];
        }

        getDisplayName(speakerId) {
            if (!speakerId) return '';
            const sp = this.speakers.get(speakerId);
            if (!sp) return '';
            const custom = (sp.customName || this.customNames[speakerId] || '').trim();
            return custom || sp.defaultLabel;
        }

        getActiveSpeakerId() {
            return this.manualSpeakerId || this.activeSpeakerId || null;
        }

        getActiveDisplayName() {
            return this.getDisplayName(this.getActiveSpeakerId());
        }

        setEnabled(next) {
            this.enabled = !!next;
            this.onChange();
        }

        setManualSpeaker(speakerId) {
            this.manualSpeakerId = speakerId || null;
            if (speakerId) this.activeSpeakerId = speakerId;
            this.onChange();
        }

        renameSpeaker(speakerId, name) {
            const sp = this.speakers.get(speakerId);
            if (!sp) return;
            const trimmed = (name || '').trim();
            sp.customName = trimmed;
            if (trimmed) this.customNames[speakerId] = trimmed;
            else delete this.customNames[speakerId];
            this.saveCustomNames();
            this.onChange();
        }

        createSpeaker(profile) {
            if (this.speakers.size >= this.maxSpeakers) {
                return this.activeSpeakerId || [...this.speakers.keys()][0] || null;
            }
            const letter = String.fromCharCode(65 + this.nextLetterIndex);
            this.nextLetterIndex += 1;
            const id = 'speaker-' + letter + '-' + Date.now().toString(36);
            const defaultLabel = this.uiLang === 'en'
                ? ('Speaker ' + letter)
                : ('发言人' + letter);
            const color = SPEAKER_COLORS[(this.speakers.size) % SPEAKER_COLORS.length];
            const savedName = (this.customNames[id] || '').trim();
            this.speakers.set(id, {
                id,
                defaultLabel,
                customName: savedName,
                color,
                profile: profile.slice()
            });
            return id;
        }

        matchSpeaker(profile) {
            let bestId = null;
            let bestDistance = Infinity;
            this.speakers.forEach((sp, id) => {
                const distance = vectorDistance(sp.profile, profile);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestId = id;
                }
            });
            if (bestId && bestDistance <= (this.sensitivity.matchDistance || DEFAULT_SENSITIVITY.matchDistance)) {
                const sp = this.speakers.get(bestId);
                sp.profile = blendVectors(sp.profile, profile, this.sensitivity.profileBlend || DEFAULT_SENSITIVITY.profileBlend);
                return bestId;
            }
            return this.createSpeaker(profile);
        }

        pushRing(samples) {
            for (let i = 0; i < samples.length; i++) {
                this.ring[this.ringWrite] = samples[i];
                this.ringWrite = (this.ringWrite + 1) % this.ring.length;
            }
        }

        getRecentSamples(seconds) {
            const count = Math.min(this.ring.length, Math.floor(this.analysisRate * seconds));
            const out = new Float32Array(count);
            let read = (this.ringWrite - count + this.ring.length) % this.ring.length;
            for (let i = 0; i < count; i++) {
                out[i] = this.ring[read];
                read = (read + 1) % this.ring.length;
            }
            return out;
        }

        analyzeSegment(samples) {
            const minSamples = this.sensitivity.minSegmentSamples || DEFAULT_SENSITIVITY.minSegmentSamples;
            if (!samples || samples.length < minSamples) return null;
            const profile = extractVoiceFingerprint(samples, this.analysisRate);
            const id = this.matchSpeaker(profile);
            this.activeSpeakerId = id;
            this.lastActiveTs = Date.now();
            this.onChange();
            return id;
        }

        commitSpeaker() {
            if (!this.enabledSetting) return '';
            if (this.manualSpeakerId) {
                return this.getDisplayName(this.manualSpeakerId);
            }
            const recent = this.getRecentSamples(1.8);
            const minSamples = this.sensitivity.minSegmentSamples || DEFAULT_SENSITIVITY.minSegmentSamples;
            if (recent.length >= minSamples) {
                this.analyzeSegment(recent);
            }
            return this.getActiveDisplayName();
        }

        handleAudioBlock(input, sampleRate) {
            const mono = input;
            const down = downsampleBuffer(mono, sampleRate, this.analysisRate);
            this.pushRing(down);
            const rms = computeRms(down);
            const vadRms = this.sensitivity.vadRms || DEFAULT_SENSITIVITY.vadRms;
            const speaking = rms >= vadRms;
            if (speaking) {
                if (!this.inSpeech) {
                    this.inSpeech = true;
                    this.segment = [];
                }
                for (let i = 0; i < down.length; i++) this.segment.push(down[i]);
                this.speechMs += (down.length / this.analysisRate) * 1000;
                if (this.segment.length > this.analysisRate * 2) {
                    this.segment = this.segment.slice(-this.analysisRate * 2);
                }
            } else if (this.inSpeech) {
                this.inSpeech = false;
                const minSamples = this.sensitivity.minSegmentSamples || DEFAULT_SENSITIVITY.minSegmentSamples;
                const minSpeechMs = this.sensitivity.minSpeechMs || DEFAULT_SENSITIVITY.minSpeechMs;
                if (this.segment.length >= minSamples && this.speechMs >= minSpeechMs) {
                    const chunk = Float32Array.from(this.segment);
                    this.analyzeSegment(chunk);
                }
                this.segment = [];
                this.speechMs = 0;
            }
        }

        startCapture(stream, audioContext) {
            this.stopCapture();
            if (!this.enabledSetting || !stream || !audioContext) return;
            try {
                this.ctx = audioContext;
                this.inputSampleRate = audioContext.sampleRate || 44100;
                this.sourceNode = audioContext.createMediaStreamSource(stream);
                this.processor = audioContext.createScriptProcessor(4096, 1, 1);
                this.processor.onaudioprocess = (event) => {
                    const input = event.inputBuffer.getChannelData(0);
                    this.handleAudioBlock(input, this.inputSampleRate);
                };
                const silent = audioContext.createGain();
                silent.gain.value = 0;
                this.sourceNode.connect(this.processor);
                this.processor.connect(silent);
                silent.connect(audioContext.destination);
            } catch (error) {
                console.warn('[OAO Meeting Speakers] capture failed:', error);
                this.stopCapture();
            }
        }

        stopCapture() {
            try { this.processor?.disconnect(); } catch (_) {}
            try { this.sourceNode?.disconnect(); } catch (_) {}
            this.processor = null;
            this.sourceNode = null;
            this.ctx = null;
            this.segment = [];
            this.inSpeech = false;
        }

        renderPanel(container, labels) {
            if (!container) return;
            labels = labels || {};
            const isZh = labels.lang !== 'en';
            const activeId = this.getActiveSpeakerId();
            const list = [...this.speakers.values()];
            if (!this.enabledSetting) {
                container.innerHTML = '<p class="oao-meeting-speaker-empty">' + (labels.disabledHint || '') + '</p>';
                return;
            }
            if (!list.length) {
                container.innerHTML = '<p class="oao-meeting-speaker-empty">' + (labels.emptyHint || '') + '</p>';
                return;
            }
            container.innerHTML = list.map((sp) => {
                const active = sp.id === activeId ? ' is-active' : '';
                const name = escapeAttr(this.getDisplayName(sp.id));
                const placeholder = escapeAttr(isZh ? '输入姓名' : 'Enter name');
                const custom = escapeAttr(sp.customName || this.customNames[sp.id] || '');
                return (
                    '<div class="oao-meeting-speaker-chip' + active + '" data-speaker-id="' + sp.id + '" style="--speaker-color:' + sp.color + '">' +
                    '<button type="button" class="oao-meeting-speaker-select" data-action="select" title="' + escapeAttr(labels.selectHint || '') + '">' +
                    '<span class="oao-meeting-speaker-dot"></span><span class="oao-meeting-speaker-label">' + name + '</span></button>' +
                    '<input type="text" class="oao-meeting-speaker-rename" value="' + custom + '" placeholder="' + placeholder + '" aria-label="' + name + '">' +
                    '</div>'
                );
            }).join('');
        }

        bindPanel(container) {
            if (!container || container.dataset.bound === '1') return;
            container.dataset.bound = '1';
            container.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-action="select"]');
                if (!btn) return;
                const chip = btn.closest('[data-speaker-id]');
                if (!chip) return;
                this.setManualSpeaker(chip.dataset.speakerId);
                this.renderPanel(container, container.__oaoLabels || {});
            });
            container.addEventListener('change', (event) => {
                const input = event.target.closest('.oao-meeting-speaker-rename');
                if (!input) return;
                const chip = input.closest('[data-speaker-id]');
                if (!chip) return;
                this.renameSpeaker(chip.dataset.speakerId, input.value);
                this.renderPanel(container, container.__oaoLabels || {});
            });
            container.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                const input = event.target.closest('.oao-meeting-speaker-rename');
                if (!input) return;
                input.blur();
            });
        }
    }

    global.OAOMeetingSpeakers = OAOMeetingSpeakers;
})(typeof window !== 'undefined' ? window : global);
