(function (global) {
  "use strict";

  const ROLES = {
    supervisor: {
      id: "supervisor",
      label: "主管单位",
      canUploadRequirements: true,
      canUploadEvidence: false,
      canParseRequirements: true,
      canViewRequirements: true,
      canViewFindings: true,
      canViewSupervisorNotes: true,
      canRunEvaluation: true,
      canConfirmFindings: true,
      canManageRemediation: true,
      canExportBundle: true,
      canManageOrg: true,
    },
    third_party: {
      id: "third_party",
      label: "三方审计单位",
      canUploadRequirements: true,
      canUploadEvidence: false,
      canParseRequirements: true,
      canViewRequirements: true,
      canViewFindings: true,
      canViewSupervisorNotes: true,
      canRunEvaluation: true,
      canConfirmFindings: true,
      canManageRemediation: true,
      canExportBundle: true,
      canManageOrg: false,
    },
    auditee: {
      id: "auditee",
      label: "被审计单位",
      canUploadRequirements: false,
      canUploadEvidence: true,
      canParseRequirements: false,
      canViewRequirements: true,
      canViewFindings: true,
      canViewSupervisorNotes: false,
      canRunEvaluation: false,
      canConfirmFindings: false,
      canManageRemediation: false,
      canSubmitRemediation: true,
      canExportBundle: true,
      canManageOrg: false,
    },
    lead: {
      id: "lead",
      label: "审计组长",
      canUploadRequirements: true,
      canUploadEvidence: true,
      canParseRequirements: true,
      canViewRequirements: true,
      canViewFindings: true,
      canViewSupervisorNotes: true,
      canRunEvaluation: true,
      canConfirmFindings: true,
      canManageRemediation: true,
      canExportBundle: true,
      canManageOrg: true,
    },
  };

  const PROJECT_TEMPLATES = {
    special: { id: "special", label: "专项/马斯克式" },
    enterprise: { id: "enterprise", label: "企业内审迎审" },
    gov: { id: "gov", label: "机关事业单位" },
    cpa: { id: "cpa", label: "社会审计" },
    mixed: { id: "mixed", label: "综合" },
  };

  function getRole(roleId) {
    return ROLES[roleId] || ROLES.auditee;
  }

  function roleStorageKey(wallet) {
    return `oao_audit_role_${String(wallet || "guest").toLowerCase()}`;
  }

  function loadSavedRole(wallet) {
    try {
      const raw = localStorage.getItem(roleStorageKey(wallet));
      if (raw && ROLES[raw]) return raw;
    } catch (_) {}
    return "";
  }

  function saveRole(wallet, roleId) {
    try {
      localStorage.setItem(roleStorageKey(wallet), roleId);
    } catch (_) {}
  }

  global.OAOAuditRoles = {
    ROLES,
    PROJECT_TEMPLATES,
    getRole,
    loadSavedRole,
    saveRole,
  };
})(typeof window !== "undefined" ? window : globalThis);
