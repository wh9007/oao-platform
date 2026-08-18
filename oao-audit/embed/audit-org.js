(function (global) {
  "use strict";

  const Store = global.OAOAuditStore;

  function orgStorageKey() {
    return "oao_audit_active_org";
  }

  async function createOrganization(name, ownerWallet) {
    const org = {
      id: Store.newId("org"),
      name: String(name || "").trim(),
      ownerWallet: String(ownerWallet || "guest").toLowerCase(),
      members: [String(ownerWallet || "guest").toLowerCase()],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await Store.put("organizations", org);
    setActiveOrgId(org.id);
    return org;
  }

  async function addMember(orgId, wallet) {
    const org = await Store.get("organizations", orgId);
    if (!org) throw new Error("组织不存在");
    const w = String(wallet || "").trim().toLowerCase();
    if (!w) throw new Error("钱包地址无效");
    if (!org.members.includes(w)) org.members.push(w);
    org.updatedAt = Date.now();
    await Store.put("organizations", org);
    return org;
  }

  async function listOrganizations(wallet) {
    const all = await Store.getAll("organizations");
    const w = String(wallet || "").toLowerCase();
    return all.filter((o) => o.members?.includes(w)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function setActiveOrgId(orgId) {
    try {
      localStorage.setItem(orgStorageKey(), orgId || "");
    } catch (_) {}
  }

  function getActiveOrgId() {
    try {
      return localStorage.getItem(orgStorageKey()) || "";
    } catch (_) {
      return "";
    }
  }

  async function getActiveOrganization(wallet) {
    const id = getActiveOrgId();
    if (id) {
      const org = await Store.get("organizations", id);
      if (org && org.members?.includes(String(wallet).toLowerCase())) return org;
    }
    const list = await listOrganizations(wallet);
    return list[0] || null;
  }

  async function assignProjectOrg(projectId, orgId) {
    const project = await Store.get("projects", projectId);
    if (!project) return null;
    project.orgId = orgId || "";
    project.updatedAt = Date.now();
    await Store.put("projects", project);
    return project;
  }

  global.OAOAuditOrg = {
    createOrganization,
    addMember,
    listOrganizations,
    getActiveOrganization,
    getActiveOrgId,
    setActiveOrgId,
    assignProjectOrg,
  };
})(typeof window !== "undefined" ? window : globalThis);
