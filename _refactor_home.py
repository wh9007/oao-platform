# -*- coding: utf-8 -*-
"""Refactor OAO home: remove 3D bg, move chat to AI panel."""
from pathlib import Path

path = Path(__file__).parent / "OAO.html"
text = path.read_text(encoding="utf-8")

# 1. Remove three.js
text = text.replace(
    '    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n',
    ''
)

# 2. Remove canvas
text = text.replace(
    '    <!-- OAO页面背景canvas -->\n    <canvas id="oaoBackgroundCanvas"></canvas>\n    \n',
    ''
)

# 3. Remove canvas / oao-home-active CSS block
old_canvas_css = """        #oaoBackgroundCanvas {
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            pointer-events: none;
            background: var(--scene-aurora-a);
        }

        body.oao-home-active #oaoBackgroundCanvas {
            pointer-events: auto;
            cursor: grab;
            transform: translateY(5vh);
        }

        body.oao-home-active.oao-scene-dragging #oaoBackgroundCanvas {
            cursor: grabbing;
        }

        body.oao-home-active .main-content,
        body.oao-home-active #pageHome {
            pointer-events: none;
        }

        body.oao-home-active .topbar,
        body.oao-home-active .nav-menu,
        body.oao-home-active .wallet-env-banner,
        body.oao-home-active #pageHome .home-center-content,
        body.oao-home-active #pageHome .oao-side-panel,
        body.oao-home-active .oao-toolbar-toggle,
        body.oao-home-active .ai-home-toggle,
        body.oao-home-active .section-tag {
            pointer-events: auto;
        }

        body.oao-scene-dragging,
        body.oao-scene-dragging * {
            user-select: none !important;
        }

"""
text = text.replace(old_canvas_css, '')

# 4. Replace pageHome HTML block
old_home = """            <!-- 中间：Logo + 文本对话区（始终显示） -->
            <div class="home-center-content">
                <div class="home-left-panel">
                    <h1 class="main-title">OAO</h1>
                    <p class="main-subtitle" id="mainSubtitle">Web3 入口 · 连接开放网络</p>
                </div>

                <div class="ai-home-input-area">
                    <div class="ai-home-header">
                        <span id="aiHomeHeaderText">准备好了，随时开始</span>
                    </div>
                    
                    <div class="ai-home-input-wrapper">
                        <button id="aiHomePlus" class="ai-home-plus" disabled title="上传文件">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 5v14M5 12h14" stroke="#999999" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </button>
                        <textarea
                            id="aiHomeInput"
                            rows="1"
                            placeholder="请连接钱包使用"
                            disabled
                        ></textarea>
                        <button id="aiHomeVoice" class="ai-home-voice" disabled title="语音输入">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M12 19.93a8 8 0 0 1-7-7h3a5 5 0 0 0 10 0h3a8 8 0 0 1-7 7v.03Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button id="aiHomeSend" class="ai-home-send" disabled title="发送">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12h14M13 6l6 6-6 6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>

                    <div class="ai-home-toolbar">
                        <label id="aiWebSearchLabel" class="ai-home-web-toggle disabled">
                            <input type="checkbox" id="aiWebSearchToggle" disabled>
                            <span id="aiWebSearchText">联网搜索（勾选：网络优先 + 知识库双回复）</span>
                        </label>
                        <span id="aiHomeStatus" class="ai-home-status">本地知识库 · AnythingLLM</span>
                    </div>
                </div>
            </div>
            
            <!-- 右侧：AI 消息区（登录后显示） -->
            <div id="aiHomeSidePanel" class="oao-side-panel ai-home-side-panel" hidden>
                <div class="oao-side-panel-shell">
                    <div class="oao-side-panel-header" id="aiHomeSidePanelTitle">AI交互信息显示</div>
                    <div class="oao-side-panel-body">
                        <div id="aiHomeMessagesContainer" class="ai-home-messages-container">
                            <div id="aiHomeMessages" class="ai-home-messages"></div>
                            <button type="button" id="aiHomeClearBtn" class="ai-home-clear-btn" title="清空对话">清空</button>
                        </div>
                    </div>
                </div>
            </div>"""

new_home = """            <div class="home-layout">
                <!-- AI 交互主区：消息滚动 + 底部输入（主流大模型主页布局） -->
                <div id="aiHomeSidePanel" class="oao-side-panel ai-home-side-panel">
                    <div class="oao-side-panel-shell">
                        <div class="oao-side-panel-header" id="aiHomeSidePanelTitle">AI交互信息显示</div>
                        <div class="oao-side-panel-body ai-home-chat-body">
                            <div id="aiHomeMessagesContainer" class="ai-home-messages-container">
                                <div class="ai-home-welcome" id="aiHomeWelcome">
                                    <p class="main-subtitle ai-home-welcome-tag" id="mainSubtitle">Web3 入口 · 连接开放网络</p>
                                    <div class="ai-home-header">
                                        <span id="aiHomeHeaderText">准备好了，随时开始</span>
                                    </div>
                                </div>
                                <div id="aiHomeMessages" class="ai-home-messages"></div>
                                <button type="button" id="aiHomeClearBtn" class="ai-home-clear-btn" title="清空对话">清空</button>
                            </div>
                            <div class="ai-home-input-area">
                                <div class="ai-home-input-wrapper">
                                    <button id="aiHomePlus" class="ai-home-plus" disabled title="上传文件">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12 5v14M5 12h14" stroke="#999999" stroke-width="2" stroke-linecap="round"/>
                                        </svg>
                                    </button>
                                    <textarea
                                        id="aiHomeInput"
                                        rows="1"
                                        placeholder="请连接钱包使用"
                                        disabled
                                    ></textarea>
                                    <button id="aiHomeVoice" class="ai-home-voice" disabled title="语音输入">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                            <path d="M12 19.93a8 8 0 0 1-7-7h3a5 5 0 0 0 10 0h3a8 8 0 0 1-7 7v.03Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                    <button id="aiHomeSend" class="ai-home-send" disabled title="发送">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M5 12h14M13 6l6 6-6 6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </button>
                                </div>
                                <div class="ai-home-toolbar">
                                    <label id="aiWebSearchLabel" class="ai-home-web-toggle disabled">
                                        <input type="checkbox" id="aiWebSearchToggle" disabled>
                                        <span id="aiWebSearchText">联网搜索（勾选：网络优先 + 知识库双回复）</span>
                                    </label>
                                    <span id="aiHomeStatus" class="ai-home-status">本地知识库 · AnythingLLM</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>"""

if old_home not in text:
    raise SystemExit("home HTML block not found")
text = text.replace(old_home, new_home)

# 5. Remove 3D IIFE
start_marker = "        // OAO 主页背景 — 沉浸式 3D 空间"
end_marker = "        // 时间席位滚动功能"
si = text.find(start_marker)
ei = text.find(end_marker)
if si == -1 or ei == -1:
    raise SystemExit(f"3D IIFE markers not found si={si} ei={ei}")
text = text[:si] + text[ei:]

# 6. Simplify showPage
old_show = """            document.body.classList.toggle('oao-home-active', pageId === 'pageHome');
            if (pageId !== 'pageHome') {
                document.body.classList.remove('oao-scene-dragging');
            }

            const canvas = document.getElementById('oaoBackgroundCanvas');
            if (canvas) {
                if (pageId === 'pageHome') {
                    canvas.style.display = 'block';
                } else {
                    canvas.style.display = 'none';
                }
            }

            if (pageId === 'pageHome' && typeof window.oaoSceneResetView === 'function') {
                window.oaoSceneResetView();
            }

"""
text = text.replace(old_show, '')

# 7. Simplify theme toggle particle update
text = text.replace(
    """            // 更新主页 3D 背景主题色
            updateParticleColor();
            
""",
    ''
)
text = text.replace(
    """        function updateParticleColor() {
            if (typeof window.oaoSceneThemeUpdate === 'function') {
                window.oaoSceneThemeUpdate();
            }
        }

""",
    ''
)

# 8. updateOaoHomeLayout - always show AI panel
text = text.replace(
    """                if (authed) {
                    if (oaoToolbarContainer) oaoToolbarContainer.hidden = false;
                    if (aiHomeSidePanel) aiHomeSidePanel.hidden = false;
                    if (oaoToolMeeting) oaoToolMeeting.disabled = false;
                    if (aiHomeMessages) aiHomeMessages.style.display = 'flex';
                    aiHomeMessagesContainer?.classList.add('visible');
                    oaoToolbarToggle?.classList.add('visible');
                    aiHomeToggle?.classList.add('visible');
                    oaoToolbarToggle.textContent = isToolbarCollapsed ? '>' : '<';
                    aiHomeToggle.textContent = isAiCollapsed ? '<' : '>';
                } else {
                    if (oaoToolbarContainer) oaoToolbarContainer.hidden = true;
                    if (aiHomeSidePanel) aiHomeSidePanel.hidden = true;
                    if (oaoToolMeeting) oaoToolMeeting.disabled = true;
                    if (aiHomeMessages) {
                        aiHomeMessages.innerHTML = '';
                        aiHomeMessages.style.display = '';
                    }
                    aiHomeMessagesContainer?.classList.remove('visible', 'has-messages', 'collapsed');
                    oaoToolbarContainer?.classList.remove('collapsed');
                    aiHomeSidePanel?.classList.remove('collapsed');
                    isToolbarCollapsed = false;
                    isAiCollapsed = false;
                    oaoToolbarToggle?.classList.remove('visible', 'collapsed');
                    aiHomeToggle?.classList.remove('visible', 'collapsed');
                }""",
    """                pageHome?.classList.toggle('home-authed', authed);

                if (aiHomeSidePanel) aiHomeSidePanel.hidden = false;
                if (aiHomeMessages) aiHomeMessages.style.display = 'flex';
                aiHomeMessagesContainer?.classList.add('visible');
                updateAiWelcomeVisibility();

                if (authed) {
                    if (oaoToolbarContainer) oaoToolbarContainer.hidden = false;
                    if (oaoToolMeeting) oaoToolMeeting.disabled = false;
                    oaoToolbarToggle?.classList.add('visible');
                    aiHomeToggle?.classList.add('visible');
                    oaoToolbarToggle.textContent = isToolbarCollapsed ? '>' : '<';
                    aiHomeToggle.textContent = isAiCollapsed ? '<' : '>';
                } else {
                    if (oaoToolbarContainer) oaoToolbarContainer.hidden = true;
                    if (oaoToolMeeting) oaoToolMeeting.disabled = true;
                    if (aiHomeMessages) aiHomeMessages.innerHTML = '';
                    aiHomeMessagesContainer?.classList.remove('has-messages', 'collapsed');
                    oaoToolbarContainer?.classList.remove('collapsed');
                    aiHomeSidePanel?.classList.remove('collapsed');
                    isToolbarCollapsed = false;
                    isAiCollapsed = false;
                    oaoToolbarToggle?.classList.remove('visible', 'collapsed');
                    aiHomeToggle?.classList.remove('visible', 'collapsed');
                }"""
)

# 9. Add updateAiWelcomeVisibility after updateAiMessagesClearState function
insert_after = """            function updateAiMessagesClearState() {
                const hasItems = !!aiHomeMessages?.querySelector('.ai-message-item');
                aiHomeMessagesContainer?.classList.toggle('has-messages', hasItems);
            }"""

insert_new = insert_after + """

            function updateAiWelcomeVisibility() {
                const hasItems = !!aiHomeMessages?.querySelector('.ai-message-item');
                aiHomeMessagesContainer?.classList.toggle('has-messages', hasItems);
                document.getElementById('aiHomeWelcome')?.classList.toggle('hidden', hasItems);
            }"""

if insert_new not in text:
    if insert_after not in text:
        raise SystemExit("updateAiMessagesClearState not found")
    text = text.replace(insert_after, insert_new)

# 10. Call updateAiWelcomeVisibility in addMessage and clear
text = text.replace(
    "                updateAiMessagesClearState();\n            }\n            \n            // 添加加载指示器",
    "                updateAiMessagesClearState();\n                updateAiWelcomeVisibility();\n            }\n            \n            // 添加加载指示器"
)

# 11. isAiMessagesPanelVisible - panel always visible now
text = text.replace(
    """            function isAiMessagesPanelVisible() {
                const authed = typeof window.isOAOAuthenticated === 'function'
                    ? window.isOAOAuthenticated()
                    : isLoggedIn;
                return authed && aiHomeSidePanel && !aiHomeSidePanel.hidden;
            }""",
    """            function isAiMessagesPanelVisible() {
                return !!aiHomeSidePanel && !aiHomeSidePanel.hidden && !aiHomeSidePanel.classList.contains('collapsed');
            }"""
)

# 12. Remove ::after 3D placeholder
text = text.replace(
    """        /* 下方留给 3D OAO Logo 展示，避免与中部 UI 重叠 */
        #pageHome.active::after {
            content: '';
            flex: 1 1 auto;
            min-height: min(46vh, 520px);
            width: 100%;
            pointer-events: none;
        }

""",
    ''
)

# 13. Inject new layout CSS before "/* 主页布局"
layout_css = """        /* 主页 — 主流 AI 聊天布局（侧栏工具 + 中央对话区 + 底部输入） */
        #pageHome.active {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            background: var(--bg-color);
            padding-top: clamp(48px, 5vh, 64px);
            padding-bottom: clamp(72px, 8vh, 96px);
            padding-left: clamp(16px, 3vw, 32px);
            padding-right: clamp(16px, 3vw, 32px);
            min-height: calc(100vh - 80px);
            box-sizing: border-box;
        }

        #pageHome.active .home-layout {
            display: flex;
            flex: 1;
            width: 100%;
            max-width: 960px;
            margin: 0 auto;
            min-height: 0;
            align-items: stretch;
            justify-content: center;
        }

        #pageHome.active.home-authed .home-layout {
            max-width: min(1280px, 100%);
            margin-left: auto;
            margin-right: clamp(16px, 2vw, 32px);
            padding-left: clamp(0px, 2vw, 620px);
        }

        #pageHome.active .ai-home-side-panel {
            position: relative;
            top: auto;
            right: auto;
            left: auto;
            bottom: auto;
            width: 100%;
            max-width: 920px;
            height: calc(100vh - clamp(140px, 18vh, 200px));
            min-height: 420px;
            flex: 1;
            z-index: 1;
        }

        #pageHome.active .ai-home-side-panel .oao-side-panel-shell {
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
        }

        [data-theme="dark"] #pageHome.active .ai-home-side-panel .oao-side-panel-shell {
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
        }

        .ai-home-chat-body {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            gap: 0;
        }

        .ai-home-welcome {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            gap: 20px;
            padding: clamp(32px, 8vh, 80px) 24px 24px;
            flex-shrink: 0;
        }

        .ai-home-welcome.hidden {
            display: none;
        }

        .ai-home-welcome-tag {
            margin: 0;
            font-size: clamp(14px, 1.6vw, 16px);
            letter-spacing: 0.22em;
            font-weight: 700;
            color: var(--text-color);
            opacity: 0.88;
        }

        #pageHome.active .ai-home-messages-container {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        #pageHome.active .ai-home-messages {
            position: relative;
            flex: 1;
            inset: auto;
            height: auto;
            min-height: 0;
            padding: 8px 12px 56px;
            overflow-y: auto;
        }

        #pageHome.active .ai-home-input-area {
            flex-shrink: 0;
            width: 100%;
            max-width: none;
            margin: 0;
            padding: 12px 4px 4px;
            border-top: 1px solid var(--border-color);
            background: transparent;
        }

        #pageHome.active .ai-home-header,
        #pageHome.active #aiHomeHeaderText {
            font-size: clamp(22px, 3vw, 32px);
            font-weight: 600;
            letter-spacing: 0.04em;
            text-shadow: none;
            color: var(--text-color);
        }

        #pageHome.active .ai-home-toolbar,
        #pageHome.active .ai-home-web-toggle,
        #pageHome.active #aiWebSearchText,
        #pageHome.active .ai-home-status {
            font-size: 12px;
            font-weight: 500;
            letter-spacing: 0.02em;
            text-shadow: none;
        }

        #pageHome.active .ai-home-side-panel .ai-message-text {
            background: var(--ai-surface-bg);
            border: 1px solid var(--ai-surface-border);
            border-radius: 18px;
            padding: 14px 18px;
            color: var(--ai-surface-text);
        }

        #pageHome.active .ai-home-side-panel .ai-message-item.user .ai-message-text {
            border-radius: 18px 18px 4px 18px;
        }

        #pageHome.active .oao-toolbar-container:not([hidden]) .oao-side-panel-shell {
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        }

        [data-theme="dark"] #pageHome.active .oao-toolbar-container:not([hidden]) .oao-side-panel-shell {
            background: rgba(18, 18, 18, 0.92);
        }

        .ai-home-toggle {
            right: clamp(16px, 2vw, 32px);
        }

        .ai-home-toggle.collapsed {
            right: clamp(16px, 2vw, 32px);
        }

"""
marker = "        /* 主页布局 - 居中 Logo/输入 + 左右侧栏（登录后显示） */"
if marker not in text:
    raise SystemExit("layout CSS marker not found")
text = text.replace(marker, layout_css + marker)

# 14. Simplify old #pageHome.active rules - remove transparent bg overrides for input in center
text = text.replace(
    """        #pageHome.active {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            background: transparent;
            padding-top: clamp(62px, 7vh, 88px);
            padding-bottom: clamp(96px, 12vh, 128px);
        }

""",
    ''
)

path.write_text(text, encoding="utf-8")
print("OK: refactored", path)
