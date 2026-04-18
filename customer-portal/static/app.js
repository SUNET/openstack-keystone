/* SUNET Cloud Portal — vanilla JS SPA on the eduID design system */

const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const nav = $("#nav");
const topbar = $("#topbar");
const userBlock = $("#user-block");
const signoutLink = $("#signout-link");

let currentUser = null;

// ---------- DOM helpers ----------

function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "className") el.className = v;
        else if (k === "htmlFor") el.setAttribute("for", v);
        else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        if (typeof child === "string" || typeof child === "number")
            el.appendChild(document.createTextNode(String(child)));
        else el.appendChild(child);
    }
    return el;
}

const clear = (el) => { el.innerHTML = ""; return el; };

function svgPlus() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "12"); svg.setAttribute("height", "12");
    svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("fill", "none");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M6 2v8M2 6h8");
    p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round");
    svg.appendChild(p);
    return svg;
}

function svgArrow() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 14 14"); svg.setAttribute("fill", "none");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M3 7h8M7 3l4 4-4 4");
    p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
    return svg;
}

// ---------- Router ----------

function navigate(hash) {
    const target = hash.startsWith("#") ? hash : "#" + hash;
    if (location.hash === target) route();
    else location.hash = target;
}

function currentRoute() { return location.hash.replace(/^#\/?/, ""); }

async function route() {
    if (!currentUser) {
        try {
            currentUser = await api("/api/me");
            if (!currentUser) { renderLogin(); return; }
        } catch {
            renderLogin();
            return;
        }
    }
    renderShell();

    const path = currentRoute();
    const parts = path.split("/").filter(Boolean);

    // Admin routes
    if (parts[0] === "admin" && parts[1] === "pricing" && parts[2] === "docs")
        return renderPricingDocs();
    if (parts[0] === "admin" && parts[1] === "billing")
        return renderAdminBillingJobs();
    if (parts[0] === "admin" && parts[1] === "pricing")
        return renderAdminPricing();
    if (parts[0] === "admin" && parts[1] === "contracts" && parts[2] === "edit" && parts[3])
        return renderAdminEditContract(parts[3]);
    if (parts[0] === "admin" && parts[1] === "contracts" && parts[2])
        return renderAdminContractDetail(parts[2]);
    if (parts[0] === "admin" && parts[1] === "customers" && parts[2] === "edit" && parts[3])
        return renderAdminEditCustomer(parts[3]);
    if (parts[0] === "admin" && parts[1] === "customers" && parts[2])
        return renderAdminCustomerDetail(parts[2]);
    if (parts[0] === "admin")
        return renderAdminCustomers();

    // Billing routes
    if (parts[0] === "billing" && parts[1] === "new")
        return renderCreateBillingJob();
    if (parts[0] === "billing" && parts[1] && parts[2] === "edit")
        return renderEditBillingJob(parts[1]);
    if (parts[0] === "billing" && parts[1])
        return renderBillingJobDetail(parts[1]);
    if (parts[0] === "billing")
        return renderBillingJobs();

    // Customer routes
    if (parts[0] === "contracts" && parts[2] === "projects" && parts[3] === "new")
        return renderCreateProject(decodeURIComponent(parts[1]));
    if (parts[0] === "contracts" && parts[2] === "projects" && parts[3] === "edit" && parts[4])
        return renderEditProject(decodeURIComponent(parts[1]), decodeURIComponent(parts[4]));
    if (parts[0] === "contracts" && parts[2] === "projects" && parts[3])
        return renderProjectDetail(decodeURIComponent(parts[1]), decodeURIComponent(parts[3]));
    if (parts[0] === "contracts" && parts[2] === "projects")
        return renderContractProjects(decodeURIComponent(parts[1]));

    return renderContracts();
}

window.addEventListener("hashchange", route);

// ---------- API ----------

async function api(path, opts = {}) {
    const resp = await fetch(path, {
        headers: { "Content-Type": "application/json", ...opts.headers },
        ...opts,
    });
    if (resp.status === 401) { currentUser = null; renderLogin(); return null; }
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || "Request failed");
    }
    if (resp.status === 204) return null;
    return resp.json();
}

// ---------- Shell ----------

function navKeyFromHash() {
    const parts = currentRoute().split("/").filter(Boolean);
    if (parts[0] === "admin") {
        if (parts[1] === "pricing" && parts[2] === "docs") return "docs";
        if (parts[1] === "pricing") return "pricing";
        if (parts[1] === "billing") return "billing";
        if (parts[1] === "contracts") return "customers";
        return "customers";
    }
    if (parts[0] === "billing") return "billing";
    if (parts[0] === "contracts" || !parts[0]) return "contracts";
    return "";
}

function renderShell() {
    if (!currentUser) {
        topbar.hidden = true;
        return;
    }
    topbar.hidden = false;
    const isAdmin = !!currentUser.is_admin;
    const active = navKeyFromHash();

    clear(nav);
    const links = isAdmin
        ? [
            { key: "customers", label: "Customers", hash: "#/admin" },
            { key: "pricing", label: "Pricing", hash: "#/admin/pricing" },
            { key: "billing", label: "Billing", hash: "#/admin/billing" },
            { key: "docs", label: "Docs", hash: "#/admin/pricing/docs" },
            { key: "contracts", label: "My Contracts", hash: "#/contracts" },
        ]
        : [
            { key: "contracts", label: "Contracts", hash: "#/contracts" },
            { key: "billing", label: "Billing", hash: "#/billing" },
            { key: "docs", label: "Pricing", hash: "#/admin/pricing/docs" },
        ];
    for (const l of links) {
        nav.appendChild(h("a", {
            href: l.hash,
            className: l.key === active ? "on" : "",
            dataset: { key: l.key },
        }, l.label));
    }

    clear(userBlock);
    userBlock.hidden = false;
    const display = currentUser.name || currentUser.email || currentUser.sub;
    const initials = (display || "??").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("") || "U";
    userBlock.appendChild(h("div", { className: "avatar" }, initials));
    userBlock.appendChild(h("div", {},
        h("div", {}, display),
        h("div", { className: "sub" }, isAdmin ? "Operator" : (currentUser.email || currentUser.sub)),
    ));
    signoutLink.hidden = false;
}

// ---------- Common building blocks ----------

function bc(...items) {
    const wrap = h("nav", { className: "bc" });
    items.forEach((item, i) => {
        if (i > 0) wrap.appendChild(h("span", { className: "sep" }, "/"));
        if (item.hash && i < items.length - 1)
            wrap.appendChild(h("a", { href: "#" + item.hash }, item.label));
        else
            wrap.appendChild(h("span", { className: "cur" }, item.label));
    });
    return wrap;
}

function phead({ eyebrow, title, lead, actions } = {}) {
    const wrap = h("div", { className: "phead" });
    const inner = h("div", actions ? { className: "phead-row" } : {});
    const titleBlock = h("div", {});
    if (eyebrow) titleBlock.appendChild(h("div", { className: "eyebrow" }, eyebrow));
    if (title) titleBlock.appendChild(h("h1", {}, title));
    if (lead) titleBlock.appendChild(h("p", { className: "lead" }, lead));
    inner.appendChild(titleBlock);
    if (actions) inner.appendChild(h("div", { className: "phead-actions" }, ...actions));
    wrap.appendChild(inner);
    return wrap;
}

function slbl(text, count, { help } = {}) {
    const wrap = h("div", { className: "slbl" });
    wrap.appendChild(document.createTextNode(text));
    if (count != null) wrap.appendChild(h("span", { className: "count" }, "· " + count));
    if (help) {
        const a = h("a", { className: "help", onclick: (e) => { e.preventDefault(); help.onClick && help.onClick(); } }, help.label);
        if (help.href) a.setAttribute("href", help.href);
        wrap.appendChild(a);
    }
    return wrap;
}

function kvRow(k, v) {
    return h("div", { className: "row" },
        h("div", { className: "k" }, k),
        v instanceof Node ? h("div", { className: "v" }, v) : h("div", { className: "v" }, v ?? "—"),
    );
}

function kvRowMono(k, v) {
    return h("div", { className: "row" },
        h("div", { className: "k" }, k),
        h("div", { className: "v mono" }, v ?? "—"),
    );
}

function kv(...rows) {
    return h("div", { className: "kv" }, ...rows);
}

function badge(text, kind) { return h("span", { className: "badge " + (kind || "neutral") }, text); }

function phaseBadge(phase) {
    if (!phase) return badge("Unknown", "pending");
    if (phase === "Ready") return badge("Ready", "ready");
    if (phase === "Provisioning" || phase === "Pending") return badge(phase, "pending");
    if (phase.toLowerCase().includes("error") || phase.toLowerCase().includes("failed")) return badge(phase, "error");
    return badge(phase, "pending");
}

function showAlert(msg, type = "error") {
    const existing = app.querySelector(".alert");
    if (existing) existing.remove();
    app.prepend(h("div", { className: `alert ${type}` }, msg));
    if (type === "success") setTimeout(() => app.querySelector(".alert.success")?.remove(), 4000);
}

function emptyState(text) {
    return h("div", { className: "empty" }, text);
}

function fmtDate(s) {
    if (!s) return "—";
    try {
        return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch { return s; }
}

function fmtDay(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString(undefined, { dateStyle: "medium" }); }
    catch { return s; }
}

// ---------- Login ----------

function renderLogin() {
    topbar.hidden = true;
    clear(app);
    app.className = "login-page";
    app.appendChild(h("div", { className: "login-card" },
        h("div", { className: "mark" }, "S"),
        h("h1", {}, "Sign in"),
        h("p", { className: "lead" }, "Use your federated identity to manage your contracts, projects and billing exports."),
        h("a", { href: "/auth/login", className: "btn primary" }, "Continue with SWAMID", svgArrow()),
        h("p", { className: "tag" }, "single sign-on · sunet"),
    ));
}

// ---------- Customer: Contracts list ----------

async function renderContracts() {
    clear(app);
    app.className = "page";
    app.appendChild(phead({
        eyebrow: "Customer",
        title: "Your contracts",
        lead: "Choose a contract to manage its cloud projects, members and billing.",
    }));

    const contracts = currentUser.contracts || [];
    if (!contracts.length) {
        app.appendChild(slbl("Active contracts", 0));
        app.appendChild(emptyState("You don't have access to any contracts yet. Ask an administrator to grant you access."));
        return;
    }

    app.appendChild(slbl("Active contracts", contracts.length));
    const grid = h("div", { className: "grid" });
    for (const c of contracts) {
        const cn = encodeURIComponent(c.contract_number);
        grid.appendChild(h("a", { className: "card link", href: `#/contracts/${cn}/projects` },
            h("div", { className: "card-head" },
                h("h3", {}, c.contract_number),
                badge(c.customer.domain, "active"),
            ),
            h("div", { className: "meta" }, c.customer.name + (c.description ? " — " + c.description : "")),
        ));
    }
    app.appendChild(grid);

    app.appendChild(h("p", { className: "hint", style: "margin-top:18px" },
        "Don't see a contract you expected? Ask your contract administrator to grant you access."));
}

// ---------- Customer: Projects in one contract ----------

async function renderContractProjects(contractNumber) {
    clear(app);
    app.className = "page";
    const contractInfo = currentUser.contracts.find(c => c.contract_number === contractNumber);
    const customerName = contractInfo ? contractInfo.customer.name : "";
    const cn = encodeURIComponent(contractNumber);

    app.appendChild(bc(
        { label: "Contracts", hash: "/contracts" },
        { label: contractNumber },
    ));
    app.appendChild(phead({
        eyebrow: "Contract",
        title: contractNumber,
        lead: customerName + (contractInfo?.description ? " — " + contractInfo.description : ""),
        actions: [
            h("a", { className: "btn primary", href: `#/contracts/${cn}/projects/new` }, svgPlus(), "New project"),
        ],
    }));

    try {
        const projects = await api(`/api/contracts/${contractNumber}/projects`);
        app.appendChild(slbl("Projects", projects.length));
        if (!projects.length) {
            app.appendChild(emptyState("No projects yet. Create one to get started."));
            return;
        }
        for (const p of projects) {
            const rn = encodeURIComponent(p.resource_name);
            app.appendChild(h("a", { className: "card link", href: `#/contracts/${cn}/projects/${rn}` },
                h("div", { className: "card-head" },
                    h("h3", {}, p.name),
                    phaseBadge(p.phase),
                ),
                p.description ? h("div", { className: "meta" }, p.description) : null,
                h("div", { className: "meta mono" }, `${p.users.length} member${p.users.length === 1 ? "" : "s"} · ${p.resource_name}`),
            ));
        }
    } catch (e) { showAlert(e.message); }
}

// ---------- Customer: Project detail ----------

async function renderProjectDetail(contractNumber, resourceName) {
    clear(app);
    app.className = "page";
    const cn = encodeURIComponent(contractNumber);
    const rn = encodeURIComponent(resourceName);

    app.appendChild(bc(
        { label: "Contracts", hash: "/contracts" },
        { label: contractNumber, hash: `/contracts/${cn}/projects` },
        { label: resourceName },
    ));

    try {
        const p = await api(`/api/contracts/${contractNumber}/projects/${resourceName}`);
        app.appendChild(phead({
            eyebrow: "Project",
            title: p.name,
            lead: p.description || null,
            actions: [
                h("a", { className: "btn ghost sm", href: `#/contracts/${cn}/projects/edit/${rn}` }, "Edit"),
                h("button", { className: "btn danger sm", onclick: async () => {
                    if (!confirm(`Delete project ${p.name}? This will remove the OpenStack project and all its resources.`)) return;
                    try {
                        await api(`/api/contracts/${contractNumber}/projects/${resourceName}`, { method: "DELETE" });
                        navigate(`/contracts/${cn}/projects`);
                    } catch (err) { showAlert(err.message); }
                }}, "Delete"),
            ],
        }));

        app.appendChild(h("div", { className: "slbl first" }, "Status"));
        app.appendChild(kv(
            kvRow("Phase", phaseBadge(p.phase)),
            kvRowMono("Resource name", p.resource_name),
            kvRow("Contract", h("a", { className: "link", href: `#/contracts/${cn}/projects` }, p.contract_number)),
        ));

        app.appendChild(slbl("Members", p.users.length));
        if (!p.users.length) {
            app.appendChild(emptyState("No members yet. Add one via Edit."));
        } else {
            const ul = h("ul", { className: "ilist" });
            for (const u of p.users) {
                ul.appendChild(h("li", {},
                    h("span", {}, u),
                    h("span", { className: "meta" }, "member"),
                ));
            }
            app.appendChild(ul);
        }
    } catch (e) { showAlert(e.message); }
}

// ---------- Customer: Create project ----------

function renderCreateProject(contractNumber) {
    clear(app);
    app.className = "page narrow-form";
    const contractInfo = currentUser.contracts.find(c => c.contract_number === contractNumber);
    const cn = encodeURIComponent(contractNumber);

    app.appendChild(bc(
        { label: "Contracts", hash: "/contracts" },
        { label: contractNumber, hash: `/contracts/${cn}/projects` },
        { label: "New project" },
    ));
    app.appendChild(phead({
        eyebrow: "New project",
        title: "Create a project",
        lead: "Projects map to a Kubernetes namespace and a billing scope. Choose a name and grant initial members access.",
    }));

    const identity = h("form", { className: "form", id: "identity-form" },
        h("h3", {}, "Identity"),
        h("label", { htmlFor: "name" }, "Project name"),
        h("input", { id: "name", name: "name", type: "text", required: true, maxlength: "64", pattern: "[a-z0-9]([a-z0-9-]*[a-z0-9])?", placeholder: "my-project", className: "mono" }),
        h("p", { className: "hint" }, "Lowercase, digits and hyphens only — must start and end with a letter or digit. Max 64 characters. Cannot be changed later."),
        h("label", { htmlFor: "desc" }, "Description"),
        h("textarea", { id: "desc", name: "description", className: "sans", placeholder: "What is this project for?" }),
        h("label", { htmlFor: "contract" }, "Contract"),
        (() => {
            const sel = h("select", { id: "contract", disabled: true });
            sel.appendChild(h("option", {}, contractNumber + (contractInfo ? " — " + contractInfo.customer.name : "")));
            return sel;
        })(),
        h("p", { className: "hint" }, "Set from the contract you came from."),
    );

    const access = h("form", { className: "form", style: "margin-top:14px", id: "access-form" },
        h("h3", {}, "Access"),
        h("label", { htmlFor: "members" }, "Members (one per line)"),
        h("textarea", { id: "members", name: "users", style: "min-height:140px", placeholder: "user1@idp\nuser2@idp" }),
        h("p", { className: "hint" }, "Add the SWAMID identifiers of users who can manage the project. You can update this anytime."),
    );

    const actions = h("div", { className: "btn-row" },
        h("button", { className: "btn primary", onclick: async (e) => {
            e.preventDefault();
            const name = identity.querySelector('[name="name"]').value.trim();
            const description = identity.querySelector('[name="description"]').value.trim();
            const usersRaw = access.querySelector('[name="users"]').value.trim();
            const users = usersRaw ? usersRaw.split("\n").map(u => u.trim()).filter(Boolean) : [];
            try {
                await api(`/api/contracts/${contractNumber}/projects`, {
                    method: "POST", body: JSON.stringify({ name, description, users }),
                });
                navigate(`/contracts/${cn}/projects`);
            } catch (err) { showAlert(err.message); }
        }}, "Create project"),
        h("a", { className: "btn ghost", href: `#/contracts/${cn}/projects` }, "Cancel"),
    );

    app.appendChild(identity);
    app.appendChild(access);
    app.appendChild(actions);
}

// ---------- Customer: Edit project ----------

async function renderEditProject(contractNumber, resourceName) {
    clear(app);
    app.className = "page narrow-form";
    const cn = encodeURIComponent(contractNumber);
    const rn = encodeURIComponent(resourceName);

    app.appendChild(bc(
        { label: "Contracts", hash: "/contracts" },
        { label: contractNumber, hash: `/contracts/${cn}/projects` },
        { label: resourceName, hash: `/contracts/${cn}/projects/${rn}` },
        { label: "Edit" },
    ));

    try {
        const p = await api(`/api/contracts/${contractNumber}/projects/${resourceName}`);
        app.appendChild(phead({ eyebrow: "Edit project", title: p.name }));

        const identity = h("form", { className: "form" },
            h("h3", {}, "Identity"),
            h("label", {}, "Project name"),
            h("input", { value: p.name, disabled: true, className: "mono" }),
            h("label", { htmlFor: "desc" }, "Description"),
            (() => {
                const t = h("textarea", { id: "desc", name: "description", className: "sans" });
                t.value = p.description || "";
                return t;
            })(),
        );
        const access = h("form", { className: "form", style: "margin-top:14px" },
            h("h3", {}, "Access"),
            h("label", { htmlFor: "members" }, "Members (one per line)"),
            (() => {
                const t = h("textarea", { id: "members", name: "users", style: "min-height:140px" });
                t.value = (p.users || []).join("\n");
                return t;
            })(),
        );
        const actions = h("div", { className: "btn-row" },
            h("button", { className: "btn primary", onclick: async (e) => {
                e.preventDefault();
                const description = identity.querySelector('[name="description"]').value.trim();
                const usersRaw = access.querySelector('[name="users"]').value.trim();
                const users = usersRaw ? usersRaw.split("\n").map(u => u.trim()).filter(Boolean) : [];
                try {
                    await api(`/api/contracts/${contractNumber}/projects/${resourceName}`, {
                        method: "PATCH", body: JSON.stringify({ description, users }),
                    });
                    navigate(`/contracts/${cn}/projects/${rn}`);
                } catch (err) { showAlert(err.message); }
            }}, "Save changes"),
            h("a", { className: "btn ghost", href: `#/contracts/${cn}/projects/${rn}` }, "Cancel"),
        );

        app.appendChild(identity);
        app.appendChild(access);
        app.appendChild(actions);
    } catch (e) { showAlert(e.message); }
}

// ---------- Billing: list ----------

async function renderBillingJobs() {
    clear(app);
    app.className = "page";
    app.appendChild(phead({
        eyebrow: "Billing",
        title: "Billing export jobs",
        lead: "Scheduled exports that deliver monthly billing CSVs to your finance system. Each job covers one or more contracts.",
        actions: [h("a", { className: "btn primary", href: "#/billing/new" }, svgPlus(), "New job")],
    }));

    try {
        const jobs = await api("/api/billing/jobs");
        const active = jobs.filter(j => j.enabled);
        const disabled = jobs.filter(j => !j.enabled);

        app.appendChild(slbl("Active jobs", active.length));
        if (!active.length) app.appendChild(emptyState("No active billing jobs."));
        for (const j of active) app.appendChild(billingJobCard(j));

        if (disabled.length) {
            app.appendChild(slbl("Disabled", disabled.length));
            for (const j of disabled) app.appendChild(billingJobCard(j));
        }
    } catch (e) { showAlert(e.message); }
}

function billingJobCard(j) {
    const scope = j.all_contracts ? "All your contracts" : `${j.contract_ids.length} contract${j.contract_ids.length === 1 ? "" : "s"}`;
    const target = j.delivery_method === "webdav"
        ? (j.delivery_config?.url ? `WebDAV → ${j.delivery_config.url}` : "WebDAV")
        : (j.delivery_config?.recipient ? `email → ${j.delivery_config.recipient}` : "email");
    return h("a", { className: "card link", href: `#/billing/${j.id}` },
        h("div", { className: "card-head" },
            h("h3", {}, j.name),
            j.enabled ? badge("Enabled", "ready") : badge("Disabled", "neutral"),
        ),
        h("div", { className: "meta" }, `${scope} · ${j.per_contract ? "per-contract files" : "single file"} · ${target}`),
        h("div", { className: "meta mono" }, j.schedule),
    );
}

// ---------- Billing: detail ----------

async function renderBillingJobDetail(jobId) {
    clear(app);
    app.className = "page";
    try {
        const job = await api(`/api/billing/jobs/${jobId}`);
        app.appendChild(bc(
            { label: "Billing jobs", hash: "/billing" },
            { label: job.name },
        ));
        app.appendChild(phead({
            eyebrow: "Billing job",
            title: job.name,
            lead: `Runs on schedule ${job.schedule} and delivers via ${job.delivery_method}.`,
            actions: [
                h("button", { className: "btn ghost sm", onclick: async () => {
                    try {
                        const r = await api(`/api/billing/jobs/${jobId}/run`, { method: "POST", body: JSON.stringify({}) });
                        showAlert(`Run completed: ${r.status}${r.files_delivered ? " · " + r.files_delivered + " files" : ""}`, r.status === "success" ? "success" : "error");
                        renderBillingJobDetail(jobId);
                    } catch (err) { showAlert(err.message); }
                }}, "Run now"),
                h("a", { className: "btn ghost sm", href: `#/billing/${jobId}/edit` }, "Edit"),
                h("button", { className: "btn danger sm", onclick: async () => {
                    if (!confirm(`Delete billing job "${job.name}"?`)) return;
                    try { await api(`/api/billing/jobs/${jobId}`, { method: "DELETE" }); navigate("/billing"); }
                    catch (err) { showAlert(err.message); }
                }}, "Delete"),
            ],
        }));

        const deliveryV = job.delivery_method === "webdav"
            ? h("span", {}, "WebDAV → ", h("span", { className: "mono" }, job.delivery_config?.url || "—"))
            : h("span", {}, "Email → ", h("span", { className: "mono" }, job.delivery_config?.recipient || "—"));

        app.appendChild(h("div", { className: "slbl first" }, "Configuration"));
        app.appendChild(kv(
            kvRow("Status", job.enabled ? badge("Enabled", "ready") : badge("Disabled", "neutral")),
            kvRowMono("Schedule", job.schedule),
            kvRow("Scope", job.all_contracts
                ? "All your accessible contracts"
                : `${job.contract_ids.length} contract${job.contract_ids.length === 1 ? "" : "s"} selected`),
            kvRow("Per-contract", job.per_contract ? "Yes — one file per contract per period" : "No — single file per period"),
            kvRow("Delivery", deliveryV),
            kvRowMono("Filename template", job.filename_template),
            kvRow("Owner", job.owner_sub),
        ));

        // Recent runs
        app.appendChild(h("div", { className: "slbl" }, "Recent runs"));
        const runs = await api(`/api/billing/jobs/${jobId}/runs`);
        if (!runs.length) {
            app.appendChild(emptyState("No executions yet."));
        } else {
            for (const r of runs) {
                const period = `${r.billing_period_start.substring(0, 7)} · ${r.files_delivered || 0} files delivered`;
                const row = h("div", { className: "run-row" },
                    h("div", { className: "when" }, fmtDay(r.started_at)),
                    h("div", { className: "det" }, period),
                    r.status === "success"
                        ? badge("Success", "success")
                        : r.status === "error" ? badge("Fail", "fail") : badge(r.status, "pending"),
                );
                if (r.error_message) row.appendChild(h("div", { className: "err" }, r.error_message));
                app.appendChild(row);
            }
        }

        // Manual run
        app.appendChild(h("div", { className: "slbl" }, "Manual run"));
        const now = new Date();
        const manualForm = h("div", { className: "form" },
            h("div", { className: "row-2" },
                h("div", { className: "field" },
                    h("label", { htmlFor: "year" }, "Year"),
                    h("input", { id: "year", name: "year", type: "number", value: String(now.getUTCFullYear()) }),
                ),
                h("div", { className: "field" },
                    h("label", { htmlFor: "month" }, "Month"),
                    h("input", { id: "month", name: "month", type: "number", min: "1", max: "12", value: String(now.getUTCMonth() + 1) }),
                ),
            ),
            h("div", { className: "btn-row" },
                h("button", { className: "btn primary sm", onclick: async () => {
                    const y = parseInt(manualForm.querySelector('[name="year"]').value, 10);
                    const m = parseInt(manualForm.querySelector('[name="month"]').value, 10);
                    try {
                        const r = await api(`/api/billing/jobs/${jobId}/run`, { method: "POST", body: JSON.stringify({ year: y, month: m }) });
                        showAlert(`Run completed: ${r.status}${r.files_delivered ? " · " + r.files_delivered + " files" : ""}`, r.status === "success" ? "success" : "error");
                        renderBillingJobDetail(jobId);
                    } catch (err) { showAlert(err.message); }
                }}, "Run for this period"),
                h("p", { className: "hint", style: "margin:0;align-self:center" }, "Re-runs are idempotent — same period overwrites the previous file."),
            ),
        );
        app.appendChild(manualForm);
    } catch (e) { showAlert(e.message); }
}

// ---------- Billing: create / edit ----------

function billingJobForm(job = null, onSubmit) {
    const contracts = currentUser.contracts || [];
    const isEdit = !!job;

    const basics = h("form", { className: "form" },
        h("h3", {}, "Basics"),
        h("label", { htmlFor: "name" }, "Job name"),
        h("input", { id: "name", name: "name", type: "text", required: true, value: job?.name || "" }),
        h("label", { className: "checkbox" },
            h("input", { type: "checkbox", name: "enabled", checked: job ? job.enabled : true }),
            "Enabled",
        ),
    );

    const contractSelect = h("select", { name: "contract_ids", multiple: true, size: String(Math.max(3, Math.min(8, contracts.length))) },
        ...contracts.map(c => {
            const o = h("option", { value: String(c.id) }, `${c.contract_number} — ${c.customer.name}`);
            if (job && job.contract_ids?.includes(c.id)) o.setAttribute("selected", "");
            return o;
        }),
    );
    const scope = h("form", { className: "form", style: "margin-top:14px" },
        h("h3", {}, "Scope"),
        h("label", { className: "checkbox" },
            h("input", { type: "checkbox", name: "all_contracts", checked: job ? job.all_contracts : true }),
            "Include all contracts you have access to",
        ),
        h("label", {}, "Or select specific contracts"),
        contractSelect,
        h("label", { className: "checkbox", style: "margin-top:18px" },
            h("input", { type: "checkbox", name: "per_contract", checked: job ? job.per_contract : false }),
            "Generate one file per contract",
        ),
        h("p", { className: "hint" }, "When unchecked, a single CSV containing all selected contracts is produced."),
    );

    const schedule = h("form", { className: "form", style: "margin-top:14px" },
        h("h3", {}, "Schedule"),
        h("label", { htmlFor: "cron" }, "Cron expression"),
        h("input", { id: "cron", name: "schedule", type: "text", className: "mono", required: true, value: job?.schedule || "0 6 1 * *", placeholder: "0 6 1 * *" }),
        h("p", { className: "hint" }, "Five-field cron syntax in UTC. Example: 0 6 1 * * runs at 06:00 on the first of every month."),
    );

    const dm = job?.delivery_method || "webdav";
    const dc = job?.delivery_config || {};
    const webdavWrap = h("div", { id: "webdav-config", style: dm === "webdav" ? "" : "display:none" },
        h("label", { htmlFor: "wurl" }, "WebDAV URL"),
        h("input", { id: "wurl", name: "webdav_url", type: "url", className: "mono", value: dc.url || "", placeholder: "https://finance.example.se/webdav/billing/" }),
        h("div", { className: "row-2" },
            h("div", { className: "field" },
                h("label", { htmlFor: "wuser" }, "Username"),
                h("input", { id: "wuser", name: "webdav_username", type: "text", value: dc.username || "" }),
            ),
            h("div", { className: "field" },
                h("label", { htmlFor: "wpw" }, "Password"),
                h("input", { id: "wpw", name: "webdav_password", type: "password", placeholder: isEdit ? "Leave blank to keep current" : "" }),
            ),
        ),
    );
    const emailWrap = h("div", { id: "email-config", style: dm === "email" ? "" : "display:none" },
        h("label", { htmlFor: "rcpt" }, "Recipient"),
        h("input", { id: "rcpt", name: "email_recipient", type: "email", value: dc.recipient || "", placeholder: "billing@example.se" }),
    );

    const dmSelect = h("select", { id: "dm", name: "delivery_method", onchange: (e) => {
        webdavWrap.style.display = e.target.value === "webdav" ? "block" : "none";
        emailWrap.style.display = e.target.value === "email" ? "block" : "none";
    }});
    const oWeb = h("option", { value: "webdav" }, "WebDAV");
    const oMail = h("option", { value: "email" }, "Email");
    if (dm === "webdav") oWeb.setAttribute("selected", "");
    if (dm === "email") oMail.setAttribute("selected", "");
    dmSelect.appendChild(oWeb);
    dmSelect.appendChild(oMail);

    const delivery = h("form", { className: "form", style: "margin-top:14px" },
        h("h3", {}, "Delivery"),
        h("label", { htmlFor: "dm" }, "Method"),
        dmSelect,
        webdavWrap,
        emailWrap,
        h("label", { htmlFor: "tpl" }, "Filename template"),
        h("input", { id: "tpl", name: "filename_template", type: "text", className: "mono", value: job?.filename_template || "billing-{year}-{month}.csv" }),
        h("p", { className: "hint" }, "Variables: ",
            h("code", {}, "{contract}"), " ",
            h("code", {}, "{year}"), " ",
            h("code", {}, "{month}"), " ",
            h("code", {}, "{day}"), " ",
            h("code", {}, "{date}")),
    );

    const submitBtn = h("button", { className: "btn primary", onclick: async (e) => {
        e.preventDefault();
        const name = basics.querySelector('[name="name"]').value.trim();
        const enabled = basics.querySelector('[name="enabled"]').checked;
        const allContracts = scope.querySelector('[name="all_contracts"]').checked;
        const perContract = scope.querySelector('[name="per_contract"]').checked;
        const contractIds = Array.from(contractSelect.selectedOptions).map(o => parseInt(o.value, 10));
        const scheduleVal = schedule.querySelector('[name="schedule"]').value.trim();
        const deliveryMethod = dmSelect.value;
        const filenameTemplate = delivery.querySelector('[name="filename_template"]').value.trim();
        const deliveryConfig = {};
        if (deliveryMethod === "webdav") {
            deliveryConfig.url = delivery.querySelector('[name="webdav_url"]').value.trim();
            deliveryConfig.username = delivery.querySelector('[name="webdav_username"]').value.trim();
            const pw = delivery.querySelector('[name="webdav_password"]').value;
            if (pw) deliveryConfig.password = pw;
            else if (isEdit) deliveryConfig.password = "********";
        } else {
            deliveryConfig.recipient = delivery.querySelector('[name="email_recipient"]').value.trim();
        }
        try {
            await onSubmit({
                name, enabled,
                all_contracts: allContracts,
                contract_ids: allContracts ? [] : contractIds,
                schedule: scheduleVal,
                delivery_method: deliveryMethod,
                delivery_config: deliveryConfig,
                filename_template: filenameTemplate,
                per_contract: perContract,
            });
        } catch (err) { showAlert(err.message); }
    }}, isEdit ? "Save changes" : "Create job");

    const cancel = h("a", { className: "btn ghost", href: isEdit ? `#/billing/${job.id}` : "#/billing" }, "Cancel");

    return [basics, scope, schedule, delivery, h("div", { className: "btn-row" }, submitBtn, cancel)];
}

function renderCreateBillingJob() {
    clear(app);
    app.className = "page narrow";
    app.appendChild(bc({ label: "Billing jobs", hash: "/billing" }, { label: "New job" }));
    app.appendChild(phead({
        eyebrow: "New billing job",
        title: "Configure a new export",
        lead: "Choose the schedule, scope and delivery destination for this billing export.",
    }));
    for (const node of billingJobForm(null, async (body) => {
        await api("/api/billing/jobs", { method: "POST", body: JSON.stringify(body) });
        navigate("/billing");
    })) app.appendChild(node);
}

async function renderEditBillingJob(jobId) {
    clear(app);
    app.className = "page narrow";
    try {
        const job = await api(`/api/billing/jobs/${jobId}`);
        app.appendChild(bc(
            { label: "Billing jobs", hash: "/billing" },
            { label: job.name, hash: `/billing/${jobId}` },
            { label: "Edit" },
        ));
        app.appendChild(phead({
            eyebrow: "Edit billing job",
            title: job.name,
            lead: "Configure when this job runs, which contracts it covers, and where the CSV is delivered.",
        }));
        for (const node of billingJobForm(job, async (body) => {
            await api(`/api/billing/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) });
            navigate(`/billing/${jobId}`);
        })) app.appendChild(node);
    } catch (e) { showAlert(e.message); }
}

// ---------- Admin: customers ----------

async function renderAdminCustomers() {
    clear(app);
    app.className = "page";
    app.appendChild(phead({
        eyebrow: "Admin",
        title: "Customers",
        lead: "Organisations with at least one active SUNET Cloud contract.",
        actions: [h("a", { className: "btn primary", href: "#/admin/customers/edit/new" }, svgPlus(), "New customer")],
    }));

    try {
        const customers = await api("/api/admin/customers");
        app.appendChild(slbl("All customers", customers.length));
        if (!customers.length) {
            app.appendChild(emptyState("No customers yet."));
            return;
        }
        for (const c of customers) {
            app.appendChild(h("a", { className: "card link", href: `#/admin/customers/${c.id}` },
                h("div", { className: "card-head" },
                    h("h3", {}, c.name),
                    badge(c.domain, "active"),
                ),
                c.description ? h("div", { className: "meta" }, c.description) : null,
                h("div", { className: "meta mono" }, `since ${fmtDay(c.created_at)}`),
            ));
        }
    } catch (e) { showAlert(e.message); }
}

async function renderAdminCustomerDetail(customerId) {
    clear(app);
    app.className = "page";

    try {
        const customer = await api(`/api/admin/customers/${customerId}`);
        app.appendChild(bc(
            { label: "Customers", hash: "/admin" },
            { label: customer.name },
        ));
        app.appendChild(phead({
            eyebrow: "Customer",
            title: customer.name,
            lead: `${customer.contracts.length} contract${customer.contracts.length === 1 ? "" : "s"} · onboarded ${fmtDay(customer.created_at)}.`,
            actions: [
                h("a", { className: "btn ghost sm", href: `#/admin/customers/edit/${customerId}` }, "Edit"),
                h("button", { className: "btn danger sm", onclick: async () => {
                    if (!confirm(`Delete customer ${customer.name}? All contracts must be deleted first.`)) return;
                    try { await api(`/api/admin/customers/${customerId}`, { method: "DELETE" }); navigate("/admin"); }
                    catch (err) { showAlert(err.message); }
                }}, "Delete"),
            ],
        }));

        app.appendChild(h("div", { className: "slbl first" }, "Identity"));
        app.appendChild(kv(
            kvRow("Name", customer.name),
            kvRowMono("Domain", customer.domain),
            kvRow("Description", customer.description || "—"),
            kvRow("Created", fmtDate(customer.created_at)),
        ));

        // Add contract form
        app.appendChild(h("div", { className: "slbl" }, "Add contract"));
        const addForm = h("form", { className: "form", onsubmit: async (e) => {
            e.preventDefault();
            const cn = addForm.querySelector('[name="contract_number"]').value.trim();
            const desc = addForm.querySelector('[name="description"]').value.trim();
            try {
                await api("/api/admin/contracts", { method: "POST", body: JSON.stringify({ customer_id: parseInt(customerId, 10), contract_number: cn, description: desc }) });
                renderAdminCustomerDetail(customerId);
            } catch (err) { showAlert(err.message); }
        }},
            h("div", { className: "row-2" },
                h("div", { className: "field" },
                    h("label", { htmlFor: "cn" }, "Contract number"),
                    h("input", { id: "cn", name: "contract_number", type: "text", required: true, pattern: "[A-Za-z0-9-]+", placeholder: "SUNET-2024-EXAMPLE-01" }),
                ),
                h("div", { className: "field" },
                    h("label", { htmlFor: "cd" }, "Description"),
                    h("input", { id: "cd", name: "description", type: "text", placeholder: "Optional" }),
                ),
            ),
            h("div", { className: "btn-row" },
                h("button", { type: "submit", className: "btn primary sm" }, "Add contract"),
            ),
        );
        app.appendChild(addForm);

        app.appendChild(slbl("Contracts", customer.contracts.length));
        if (!customer.contracts.length) {
            app.appendChild(emptyState("No contracts yet."));
        } else {
            for (const c of customer.contracts) {
                app.appendChild(h("a", { className: "card link", href: `#/admin/contracts/${c.id}` },
                    h("div", { className: "card-head" },
                        h("h3", {}, c.contract_number),
                        badge(c.description || "active", "active"),
                    ),
                    c.description ? h("div", { className: "meta" }, c.description) : null,
                    h("div", { className: "meta mono" }, `created ${fmtDay(c.created_at)}`),
                ));
            }
        }
    } catch (e) { showAlert(e.message); }
}

async function renderAdminEditCustomer(customerId) {
    clear(app);
    app.className = "page narrow-form";
    const isNew = customerId === "new";

    let customer = { name: "", domain: "", description: "" };
    if (!isNew) {
        try { customer = await api(`/api/admin/customers/${customerId}`); }
        catch (e) { showAlert(e.message); return; }
    }

    app.appendChild(bc(
        { label: "Customers", hash: "/admin" },
        ...(isNew ? [{ label: "New" }] : [{ label: customer.name, hash: `/admin/customers/${customerId}` }, { label: "Edit" }]),
    ));
    app.appendChild(phead({
        eyebrow: isNew ? "New customer" : "Edit customer",
        title: isNew ? "Onboard a customer" : customer.name,
    }));

    const form = h("form", { className: "form", onsubmit: async (e) => {
        e.preventDefault();
        const name = form.querySelector('[name="name"]').value.trim();
        const domain = form.querySelector('[name="domain"]').value.trim();
        const description = form.querySelector('[name="description"]').value.trim();
        try {
            if (isNew) {
                const c = await api("/api/admin/customers", { method: "POST", body: JSON.stringify({ name, domain, description }) });
                navigate(`/admin/customers/${c.id}`);
            } else {
                await api(`/api/admin/customers/${customerId}`, { method: "PATCH", body: JSON.stringify({ name, domain, description }) });
                navigate(`/admin/customers/${customerId}`);
            }
        } catch (err) { showAlert(err.message); }
    }},
        h("h3", {}, "Identity"),
        h("label", { htmlFor: "n" }, "Name"),
        h("input", { id: "n", name: "name", type: "text", required: true, value: customer.name || "" }),
        h("label", { htmlFor: "d" }, "Domain"),
        h("input", { id: "d", name: "domain", type: "text", required: true, pattern: "[a-z0-9.-]+", className: "mono", value: customer.domain || "" }),
        h("label", { htmlFor: "ds" }, "Description"),
        h("input", { id: "ds", name: "description", type: "text", value: customer.description || "" }),
    );
    app.appendChild(form);
    app.appendChild(h("div", { className: "btn-row" },
        h("button", { className: "btn primary", onclick: () => form.requestSubmit() }, isNew ? "Create customer" : "Save changes"),
        h("a", { className: "btn ghost", href: isNew ? "#/admin" : `#/admin/customers/${customerId}` }, "Cancel"),
    ));
}

// ---------- Admin: contract detail ----------

async function renderAdminContractDetail(contractId) {
    clear(app);
    app.className = "page";

    try {
        const contract = await api(`/api/admin/contracts/${contractId}`);
        app.appendChild(bc(
            { label: "Customers", hash: "/admin" },
            { label: contract.customer.name, hash: `/admin/customers/${contract.customer.id}` },
            { label: contract.contract_number },
        ));
        app.appendChild(phead({
            eyebrow: "Contract",
            title: contract.contract_number,
            lead: `${contract.customer.name} · ${contract.users.length} user${contract.users.length === 1 ? "" : "s"} with portal access.`,
            actions: [
                h("button", { className: "btn danger sm", onclick: async () => {
                    if (!confirm(`Delete contract ${contract.contract_number}? All projects must be deleted first.`)) return;
                    try {
                        await api(`/api/admin/contracts/${contractId}`, { method: "DELETE" });
                        navigate(`/admin/customers/${contract.customer.id}`);
                    } catch (err) { showAlert(err.message); }
                }}, "Delete"),
            ],
        }));

        // Description
        app.appendChild(h("div", { className: "slbl first" }, "Description"));
        const descForm = h("form", { className: "form", onsubmit: async (e) => {
            e.preventDefault();
            const description = descForm.querySelector('[name="description"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}`, { method: "PATCH", body: JSON.stringify({ description }) });
                showAlert("Description saved", "success");
            } catch (err) { showAlert(err.message); }
        }},
            h("label", { htmlFor: "d" }, "Contract description"),
            (() => {
                const t = h("textarea", { id: "d", name: "description", className: "sans", style: "min-height:64px" });
                t.value = contract.description || "";
                return t;
            })(),
            h("div", { className: "btn-row" },
                h("button", { type: "submit", className: "btn primary sm" }, "Save description"),
            ),
        );
        app.appendChild(descForm);

        // Rebate
        app.appendChild(h("div", { className: "slbl" }, "Rebate"));
        const rebateForm = h("form", { className: "form", onsubmit: async (e) => {
            e.preventDefault();
            const v = rebateForm.querySelector('[name="rebate"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}/rebate`, { method: "PUT", body: JSON.stringify({ rebate_percent: parseFloat(v) }) });
                renderAdminContractDetail(contractId);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", { htmlFor: "r" }, "Rebate percent"),
            h("div", { className: "input-suffix" },
                h("input", { id: "r", name: "rebate", type: "number", min: "0", max: "100", step: "0.01", value: contract.rebate_percent != null ? String(contract.rebate_percent) : "" }),
                h("span", { className: "suffix" }, "% off all line items"),
            ),
            h("p", { className: "hint" }, "Applied as a flat discount on every billed line for this contract. Set to 0 to remove."),
            h("div", { className: "btn-row" },
                h("button", { type: "submit", className: "btn primary sm" }, "Apply rebate"),
                contract.rebate_percent != null
                    ? h("button", { type: "button", className: "btn ghost sm", onclick: async () => {
                        try {
                            await api(`/api/admin/contracts/${contractId}/rebate`, { method: "DELETE" });
                            renderAdminContractDetail(contractId);
                        } catch (err) { showAlert(err.message); }
                    }}, "Remove rebate")
                    : null,
            ),
        );
        app.appendChild(rebateForm);

        // Price overrides
        let overrides = [];
        try { overrides = await api(`/api/admin/contracts/${contractId}/pricing`); } catch {}
        app.appendChild(slbl("Price overrides", overrides.length, {
            help: { label: "How does pricing work?", href: "#/admin/pricing/docs" },
        }));
        if (!overrides.length) {
            app.appendChild(h("p", { className: "hint", style: "margin-bottom:10px" }, "Using global default prices."));
        } else {
            for (const o of overrides) {
                app.appendChild(h("div", { className: "pt-row" },
                    h("div", {},
                        h("div", { className: "name" }, o.resource_type),
                        h("div", { className: "meta" }, "Override"),
                    ),
                    h("div", { className: "price" }, `${Number(o.unit_price).toFixed(4)} SEK `, h("span", { className: "unit" }, "/ hour")),
                    h("button", { className: "btn ghost tiny", onclick: async () => {
                        if (!confirm(`Remove override for ${o.resource_type}?`)) return;
                        try {
                            await api(`/api/admin/contracts/${contractId}/pricing/${encodeURIComponent(o.resource_type)}`, { method: "DELETE" });
                            renderAdminContractDetail(contractId);
                        } catch (err) { showAlert(err.message); }
                    }}, "Remove"),
                ));
            }
        }

        let globalPrices = [];
        try { globalPrices = await api("/api/admin/pricing"); } catch {}
        if (globalPrices.length) {
            const sel = h("select", { id: "rt", name: "resource_type", required: true },
                h("option", { value: "" }, "— Select resource type —"),
                ...globalPrices.map(p => h("option", { value: p.resource_type }, `${p.resource_type} (${p.unit_price} SEK / ${p.unit})`)),
            );
            const addOverride = h("form", { className: "form", style: "margin-top:14px", onsubmit: async (e) => {
                e.preventDefault();
                const rt = sel.value;
                const price = addOverride.querySelector('[name="unit_price"]').value.trim();
                if (!rt) return;
                try {
                    await api(`/api/admin/contracts/${contractId}/pricing/${encodeURIComponent(rt)}`, {
                        method: "PUT", body: JSON.stringify({ resource_type: rt, unit_price: parseFloat(price) }),
                    });
                    renderAdminContractDetail(contractId);
                } catch (err) { showAlert(err.message); }
            }},
                h("h3", {}, "Add override"),
                h("div", { className: "row-2" },
                    h("div", { className: "field" },
                        h("label", { htmlFor: "rt" }, "Resource type"),
                        sel,
                    ),
                    h("div", { className: "field" },
                        h("label", { htmlFor: "up" }, "Unit price (SEK)"),
                        h("input", { id: "up", name: "unit_price", type: "number", step: "0.0001", min: "0", required: true, placeholder: "0.00" }),
                    ),
                ),
                h("div", { className: "btn-row" },
                    h("button", { type: "submit", className: "btn primary sm" }, "Add override"),
                ),
            );
            app.appendChild(addOverride);
        } else {
            app.appendChild(h("p", { className: "hint" }, "Configure global prices first (Admin → Pricing) before adding overrides."));
        }

        // Portal access
        app.appendChild(slbl("Portal access", `${contract.users.length} user${contract.users.length === 1 ? "" : "s"}`));
        if (!contract.users.length) {
            app.appendChild(emptyState("No users have access yet."));
        } else {
            const ul = h("ul", { className: "ilist" });
            for (const sub of contract.users) {
                ul.appendChild(h("li", {},
                    h("span", {}, sub),
                    h("button", { className: "btn ghost tiny", onclick: async () => {
                        if (!confirm(`Revoke access for ${sub}?`)) return;
                        try {
                            await api(`/api/admin/contracts/${contractId}/users/${encodeURIComponent(sub)}`, { method: "DELETE" });
                            renderAdminContractDetail(contractId);
                        } catch (err) { showAlert(err.message); }
                    }}, "Revoke"),
                ));
            }
            app.appendChild(ul);
        }

        const grant = h("form", { className: "form", style: "margin-top:10px", onsubmit: async (e) => {
            e.preventDefault();
            const v = grant.querySelector('[name="user_sub"]').value.trim();
            if (!v) return;
            try {
                await api(`/api/admin/contracts/${contractId}/users`, { method: "POST", body: JSON.stringify({ user_sub: v }) });
                renderAdminContractDetail(contractId);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", { htmlFor: "u" }, "Grant access to user"),
            h("div", { className: "input-suffix" },
                h("input", { id: "u", name: "user_sub", type: "text", required: true, placeholder: "user@idp" }),
                h("button", { type: "submit", className: "btn primary sm" }, "Grant"),
            ),
            h("p", { className: "hint" }, "User is identified by their SWAMID ", h("code", {}, "sub"), " claim — typically their email."),
        );
        app.appendChild(grant);
    } catch (e) { showAlert(e.message); }
}

async function renderAdminEditContract(contractId) {
    clear(app);
    app.className = "page narrow-form";
    try {
        const contract = await api(`/api/admin/contracts/${contractId}`);
        app.appendChild(bc(
            { label: "Customers", hash: "/admin" },
            { label: contract.customer.name, hash: `/admin/customers/${contract.customer.id}` },
            { label: contract.contract_number, hash: `/admin/contracts/${contractId}` },
            { label: "Edit" },
        ));
        app.appendChild(phead({ eyebrow: "Edit contract", title: contract.contract_number }));

        const form = h("form", { className: "form", onsubmit: async (e) => {
            e.preventDefault();
            const description = form.querySelector('[name="description"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}`, { method: "PATCH", body: JSON.stringify({ description }) });
                navigate(`/admin/contracts/${contractId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", {}, "Contract number"),
            h("input", { value: contract.contract_number, disabled: true, className: "mono" }),
            h("label", { htmlFor: "d" }, "Description"),
            h("input", { id: "d", name: "description", type: "text", value: contract.description || "" }),
        );
        app.appendChild(form);
        app.appendChild(h("div", { className: "btn-row" },
            h("button", { className: "btn primary", onclick: () => form.requestSubmit() }, "Save changes"),
            h("a", { className: "btn ghost", href: `#/admin/contracts/${contractId}` }, "Cancel"),
        ));
    } catch (e) { showAlert(e.message); }
}

// ---------- Admin: pricing ----------

async function renderAdminPricing() {
    clear(app);
    app.className = "page";
    app.appendChild(phead({
        eyebrow: "Admin",
        title: "Global pricing",
        lead: "Default unit prices for every billable resource. Contracts may override individual lines on their own configuration page.",
        actions: [h("a", { className: "btn ghost sm", href: "#/admin/pricing/docs" }, "View pricing docs →")],
    }));

    let prices = [];
    try { prices = await api("/api/admin/pricing"); } catch (e) { showAlert(e.message); }
    app.appendChild(slbl("Configured prices", prices.length));
    if (!prices.length) {
        app.appendChild(emptyState("No prices configured yet."));
    } else {
        for (const p of prices) {
            const meta = p.metadata_field && p.metadata_value ? `${p.metadata_field} = ${p.metadata_value}` : "Base price";
            app.appendChild(h("div", { className: "pt-row" },
                h("div", {},
                    h("div", { className: "name" }, p.resource_type),
                    h("div", { className: "meta" }, meta),
                ),
                h("div", { className: "price" }, `${Number(p.unit_price).toFixed(6)} SEK `, h("span", { className: "unit" }, "/ " + p.unit)),
                h("button", { className: "btn ghost tiny", onclick: async () => {
                    if (!confirm(`Remove price for ${p.resource_type}?`)) return;
                    try { await api(`/api/admin/pricing/${p.id}`, { method: "DELETE" }); renderAdminPricing(); }
                    catch (err) { showAlert(err.message); }
                }}, "Remove"),
            ));
        }
    }

    // Add resource price form (Gnocchi-aware)
    let metrics = [];
    try { metrics = await api("/api/admin/pricing/metrics"); } catch {}
    const metricUnits = {};
    const metricMeta = {};
    for (const m of metrics) {
        metricUnits[m.metric_type] = m.unit || "";
        metricMeta[m.metric_type] = m.metadata_fields || [];
    }

    const metaContainer = h("div", { id: "meta-fields", style: "display:none;margin-top:14px" });

    const metricSelect = metrics.length
        ? h("select", { id: "rt", name: "resource_type", required: true, onchange: (e) => {
            const rt = e.target.value;
            const fields = metricMeta[rt] || [];
            clear(metaContainer);
            if (fields.length && fields[0].values?.length) {
                const field = fields[0];
                metaContainer.style.display = "block";
                metaContainer.appendChild(h("input", { type: "hidden", name: "metadata_field", value: field.field }));
                metaContainer.appendChild(h("label", {}, `${field.field} (optional — leave blank for base price)`));
                metaContainer.appendChild(h("select", { name: "metadata_value" },
                    h("option", { value: "" }, "— All (base price) —"),
                    ...field.values.map(v => h("option", { value: v }, v)),
                ));
            } else {
                metaContainer.style.display = "none";
            }
        }},
            h("option", { value: "" }, "— Select metric —"),
            ...metrics.map(m => h("option", { value: m.metric_type }, `${m.metric_type} (${m.unit})`)),
        )
        : h("input", { id: "rt", name: "resource_type", type: "text", required: true, placeholder: "metric type (Gnocchi unavailable)" });

    const addForm = h("form", { className: "form", style: "margin-top:18px", onsubmit: async (e) => {
        e.preventDefault();
        const rt = (addForm.querySelector('[name="resource_type"]').value || "").trim();
        const price = addForm.querySelector('[name="unit_price"]').value.trim();
        const unit = metricUnits[rt] || "hours";
        const metaField = addForm.querySelector('[name="metadata_field"]');
        const metaValue = addForm.querySelector('[name="metadata_value"]');
        if (!rt) return;
        const body = { resource_type: rt, unit_price: parseFloat(price), unit };
        if (metaField && metaValue && metaValue.value) {
            body.metadata_field = metaField.value;
            body.metadata_value = metaValue.value;
        }
        try {
            await api("/api/admin/pricing", { method: "POST", body: JSON.stringify(body) });
            renderAdminPricing();
        } catch (err) { showAlert(err.message); }
    }},
        h("h3", {}, "Add resource price"),
        h("div", { className: "row-2" },
            h("div", { className: "field" },
                h("label", { htmlFor: "rt" }, "Resource type"),
                metricSelect,
            ),
            h("div", { className: "field" },
                h("label", { htmlFor: "up" }, "Unit price (SEK per hour)"),
                h("input", { id: "up", name: "unit_price", type: "number", step: "0.000001", min: "0", required: true, placeholder: "0.000000" }),
            ),
        ),
        metaContainer,
        h("p", { className: "hint" }, "The billing system automatically detects the collection interval from Gnocchi and converts to hours."),
        h("div", { className: "btn-row" },
            h("button", { type: "submit", className: "btn primary sm" }, "Add price"),
        ),
    );
    app.appendChild(addForm);

    if (!metrics.length) {
        app.appendChild(h("p", { className: "hint" }, "Could not connect to Gnocchi to discover available metrics. You can enter metric types manually."));
    }
}

// ---------- Pricing docs ----------

function renderPricingDocs() {
    clear(app);
    app.className = "page narrow";
    app.appendChild(phead({
        eyebrow: "Pricing reference",
        title: "How billing works",
        lead: "SUNET Cloud bills by metered resource consumption per project, rolled up to the project's contract.",
    }));

    const doc = h("div", { className: "doc" });
    doc.innerHTML = `
        <h3>Overview</h3>
        <p>The billing system queries <strong>Gnocchi</strong> (the metrics database) for resource usage data,
        then applies the prices you configure here to calculate costs for each contract.</p>
        <p>The pipeline is: <code>Ceilometer</code> (collects metrics) → <code>Gnocchi</code> (stores time-series data)
        → <code>Portal billing</code> (queries usage, applies prices, generates CSV).</p>

        <h3>How metering works</h3>
        <p>Ceilometer polls OpenStack services at a fixed interval and stores measurements in Gnocchi.
        Each measurement is a <strong>data point</strong> — one sample taken at one point in time.</p>
        <p>The billing system <strong>automatically detects</strong> the collection interval by examining
        the timestamps in Gnocchi's data. If the interval changes, billing adapts automatically. All usage
        is converted to <strong>hours</strong> before pricing is applied.</p>

        <h3>The four-step calculation</h3>
        <ol>
            <li>Each <strong>project</strong> belongs to exactly one <strong>contract</strong>.</li>
            <li>Every billable <strong>resource</strong> the project consumes is metered hourly.</li>
            <li>Each metered line is multiplied by the resource's <strong>unit price</strong>. By default this is the global price; if the contract has a price override for that resource, the override wins.</li>
            <li>The contract's <strong>rebate percent</strong> is applied to the line total. The result appears on the monthly CSV.</li>
        </ol>

        <h3>Resource types</h3>
        <table>
            <thead><tr><th>Metric</th><th>What it measures</th><th>Priced per</th></tr></thead>
            <tbody>
                <tr><td><code>instance</code></td><td>Virtual machine existence</td><td>hour per instance</td></tr>
                <tr><td><code>volume.size</code></td><td>Block storage volume size</td><td>hour per GB</td></tr>
                <tr><td><code>image.size</code></td><td>Glance image size</td><td>hour per MB</td></tr>
                <tr><td><code>ip.floating</code></td><td>Floating IP allocation</td><td>hour per IP</td></tr>
                <tr><td><code>radosgw.objects.size</code></td><td>S3/object storage usage</td><td>hour per GB</td></tr>
                <tr><td><code>network.incoming.bytes.rate</code></td><td>Inbound network traffic rate</td><td>hour per MB</td></tr>
                <tr><td><code>network.outgoing.bytes.rate</code></td><td>Outbound network traffic rate</td><td>hour per MB</td></tr>
            </tbody>
        </table>

        <h3>Metadata-based pricing</h3>
        <p>Some metrics have <strong>metadata fields</strong> that allow more granular pricing. For example,
        the <code>instance</code> metric includes <code>flavor_name</code>, so you can set different prices
        for different VM sizes. The <code>volume.size</code> metric includes <code>volume_type</code>
        for differentiating fast vs large storage.</p>
        <p>When billing, the system matches prices in this order:</p>
        <ol>
            <li><strong>Specific price</strong> — matches both the metric type AND the metadata value.</li>
            <li><strong>Base price</strong> — matches just the metric type, used as fallback.</li>
        </ol>

        <h3>Worked example</h3>
        <div class="example">
            <p><strong>Example: VM flavor b2.c4r8 at 1,095 SEK/month</strong></p>
            <p>1. Hourly rate: 1,095 ÷ 730 = <strong>1.50 SEK/hour</strong></p>
            <p>2. Resource type: <code>instance</code></p>
            <p>3. Metadata: <code>flavor_name = b2.c4r8</code></p>
            <p>4. Unit price: <code>1.50</code></p>
            <p>5. An instance running all month = 730 × 1.50 = 1,095 SEK</p>
        </div>

        <h3>Contract overrides and rebates</h3>
        <p><strong>Price overrides</strong> let you set a different hourly price for a specific contract.</p>
        <p><strong>Rebates</strong> are a percentage discount applied after the price calculation:
        <code>hours × unit_price × (1 − rebate%/100) = cost</code></p>

        <h3>Delivery</h3>
        <p>Billing exports run as scheduled <strong>billing jobs</strong>. A job covers one or more contracts,
        runs on a cron schedule, and delivers CSVs by WebDAV or email. Filenames support <code>{contract}</code>,
        <code>{year}</code> and <code>{month}</code> tokens.</p>

        <h3>Re-runs</h3>
        <p>Manual runs of past periods are idempotent — they overwrite the previous CSV in place. Use this
        to correct a delivery that failed or to re-issue with updated pricing.</p>
    `;
    app.appendChild(doc);
}

// ---------- Admin: all billing jobs ----------

async function renderAdminBillingJobs() {
    clear(app);
    app.className = "page";
    app.appendChild(phead({
        eyebrow: "Admin",
        title: "All billing jobs",
        lead: "Every billing export configured across all users.",
    }));

    try {
        const jobs = await api("/api/billing/jobs?all=true");
        app.appendChild(slbl("All jobs", jobs.length));
        if (!jobs.length) {
            app.appendChild(emptyState("No billing jobs configured."));
            return;
        }
        for (const j of jobs) {
            const target = j.delivery_method === "webdav"
                ? (j.delivery_config?.url || "WebDAV")
                : (j.delivery_config?.recipient || "email");
            app.appendChild(h("a", { className: "card link", href: `#/billing/${j.id}` },
                h("div", { className: "card-head" },
                    h("h3", {}, j.name),
                    j.enabled ? badge("Enabled", "ready") : badge("Disabled", "neutral"),
                ),
                h("div", { className: "meta" }, `Owner: ${j.owner_sub} · ${j.delivery_method} → ${target}`),
                h("div", { className: "meta mono" }, j.schedule),
            ));
        }
    } catch (e) { showAlert(e.message); }
}

// ---------- Init ----------

route();
