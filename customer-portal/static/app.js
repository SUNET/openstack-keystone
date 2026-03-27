/* SUNET Cloud Portal — vanilla JS SPA with hash routing */

const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const nav = $("#nav");

let currentUser = null;

// --- Router ---

function navigate(hash) {
    if (location.hash === "#" + hash) route();
    else location.hash = hash;
}

function currentRoute() { return location.hash.replace(/^#\/?/, ""); }

async function route() {
    if (!currentUser) {
        try {
            currentUser = await api("/api/me");
            if (!currentUser) { renderLogin(); return; }
            renderNav();
        } catch {
            renderLogin();
            return;
        }
    }

    const path = currentRoute();
    const parts = path.split("/").filter(Boolean);

    // Customer routes
    if (parts[0] === "contracts" && parts[2] === "projects" && parts[3] === "new")
        return renderCreateProject(decodeURIComponent(parts[1]));
    if (parts[0] === "contracts" && parts[2] === "projects" && parts[3] === "edit" && parts[4])
        return renderEditProject(decodeURIComponent(parts[1]), decodeURIComponent(parts[4]));
    if (parts[0] === "contracts" && parts[2] === "projects" && parts[3])
        return renderProjectDetail(decodeURIComponent(parts[1]), decodeURIComponent(parts[3]));
    if (parts[0] === "contracts" && parts[2] === "projects")
        return renderContractProjects(decodeURIComponent(parts[1]));
    if (parts[0] === "contracts" || !path)
        return renderContracts();

    // Billing routes
    if (parts[0] === "billing" && parts[1] === "new")
        return renderCreateBillingJob();
    if (parts[0] === "billing" && parts[1] && parts[2] === "edit")
        return renderEditBillingJob(parts[1]);
    if (parts[0] === "billing" && parts[1])
        return renderBillingJobDetail(parts[1]);
    if (parts[0] === "billing")
        return renderBillingJobs();

    // Admin routes
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

    renderContracts();
}

window.addEventListener("hashchange", route);

// --- API helpers ---

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

// --- Rendering helpers ---

function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "className") el.className = v;
        else if (k === "htmlFor") el.setAttribute("for", v);
        else el.setAttribute(k, v);
    }
    for (const child of children) {
        if (typeof child === "string") el.appendChild(document.createTextNode(child));
        else if (child) el.appendChild(child);
    }
    return el;
}

function clear(el) { el.innerHTML = ""; return el; }

function breadcrumbs(...items) {
    const bc = h("nav", { className: "breadcrumbs" });
    items.forEach((item, i) => {
        if (i > 0) bc.appendChild(h("span", { className: "sep" }, "/"));
        if (i < items.length - 1 && item.hash)
            bc.appendChild(h("a", { href: "#/" + item.hash }, item.label));
        else
            bc.appendChild(h("span", { className: "current" }, item.label));
    });
    return bc;
}

function phaseBadge(phase) {
    if (!phase) return h("span", { className: "badge badge-pending" }, "Unknown");
    if (phase === "Ready") return h("span", { className: "badge badge-ready" }, "Ready");
    if (phase.includes("Error")) return h("span", { className: "badge badge-error" }, phase);
    return h("span", { className: "badge badge-pending" }, phase);
}

function showAlert(msg, type = "error") {
    const existing = app.querySelector(".alert");
    if (existing) existing.remove();
    app.prepend(h("div", { className: `alert alert-${type}` }, msg));
}

// --- Navigation ---

function renderNav() {
    clear(nav);
    if (!currentUser) return;
    nav.appendChild(h("a", { href: "#/contracts" }, "My Contracts"));
    nav.appendChild(h("a", { href: "#/billing" }, "Billing"));
    if (currentUser.is_admin) {
        nav.appendChild(h("a", { href: "#/admin" }, "Admin"));
        nav.appendChild(h("a", { href: "#/admin/pricing" }, "Pricing"));
    }
    nav.appendChild(h("a", { href: "#", className: "nav-user" }, currentUser.sub));
    nav.appendChild(h("a", { href: "/auth/logout", className: "nav-logout" }, "Sign out"));
}

// --- Login ---

function renderLogin() {
    renderNav();
    clear(app).appendChild(
        h("div", { className: "login-prompt" },
            h("h2", {}, "SUNET Cloud Portal"),
            h("p", {}, "Sign in to manage your cloud projects."),
            h("a", { href: "/auth/login", className: "btn btn-primary" }, "Sign in with SSO"),
        )
    );
}

// ========== CUSTOMER VIEWS ==========

async function renderContracts() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "My Contracts" }));
    app.appendChild(h("h2", {}, "My Contracts"));
    app.appendChild(h("p", { className: "page-desc" }, "Select a contract to view and manage its projects."));
    try {
        const user = await api("/api/me");
        if (!user) return;
        currentUser = user;
        renderNav();
        if (!user.contracts.length) {
            app.appendChild(h("p", { className: "empty" }, "You don't have access to any contracts yet. Ask an administrator to grant you access."));
            return;
        }
        for (const c of user.contracts) {
            const cn = encodeURIComponent(c.contract_number);
            app.appendChild(
                h("a", { href: `#/contracts/${cn}/projects`, className: "card card-clickable", style: "display:block;text-decoration:none;color:inherit" },
                    h("div", { className: "card-header" },
                        h("h3", {}, c.contract_number),
                        h("span", { className: "badge badge-neutral" }, c.customer.domain),
                    ),
                    h("p", { className: "meta" }, c.customer.name + (c.description ? " — " + c.description : "")),
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

async function renderContractProjects(contractNumber) {
    clear(app);
    const contractInfo = currentUser.contracts.find(c => c.contract_number === contractNumber);
    const customerName = contractInfo ? contractInfo.customer.name : "";
    const cn = encodeURIComponent(contractNumber);

    app.appendChild(breadcrumbs(
        { label: "My Contracts", hash: "contracts" },
        { label: contractNumber },
    ));
    app.appendChild(h("h2", {}, "Projects"));
    app.appendChild(h("p", { className: "page-desc" }, customerName + " — " + contractNumber));
    app.appendChild(h("a", { href: `#/contracts/${cn}/projects/new`, className: "btn btn-primary btn-small", style: "display:inline-block;margin-bottom:16px;text-decoration:none" }, "+ New Project"));

    try {
        const projects = await api(`/api/contracts/${contractNumber}/projects`);
        if (!projects.length) {
            app.appendChild(h("p", { className: "empty" }, "No projects yet. Create one to get started."));
            return;
        }
        for (const p of projects) {
            const rn = encodeURIComponent(p.resource_name);
            app.appendChild(
                h("a", { href: `#/contracts/${cn}/projects/${rn}`, className: "card card-clickable", style: "display:block;text-decoration:none;color:inherit" },
                    h("div", { className: "card-header" },
                        h("h3", {}, p.name),
                        phaseBadge(p.phase),
                    ),
                    p.description ? h("p", { className: "meta" }, p.description) : null,
                    h("p", { className: "meta" }, "Users: " + p.users.join(", ")),
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

async function renderProjectDetail(contractNumber, resourceName) {
    clear(app);
    const cn = encodeURIComponent(contractNumber);
    const rn = encodeURIComponent(resourceName);

    app.appendChild(breadcrumbs(
        { label: "My Contracts", hash: "contracts" },
        { label: contractNumber, hash: `contracts/${cn}/projects` },
        { label: resourceName },
    ));

    try {
        const p = await api(`/api/contracts/${contractNumber}/projects/${resourceName}`);
        app.appendChild(h("h2", {}, p.name));
        app.appendChild(h("div", { className: "card", style: "margin-bottom:16px" },
            h("div", { className: "card-header" },
                h("div", { className: "section-label", style: "margin:0" }, "Status"),
                phaseBadge(p.phase),
            ),
        ));

        app.appendChild(h("div", { className: "card" },
            h("div", { className: "section-label", style: "margin-top:0" }, "Description"),
            h("p", {}, p.description || "(none)"),
            h("div", { className: "section-label" }, "Users"),
            ...p.users.map(u => h("p", {}, u)),
            p.users.length === 0 ? h("p", { className: "meta" }, "(none)") : null,
            h("div", { className: "section-label" }, "Contract"),
            h("p", {}, p.contract_number),
        ));

        app.appendChild(h("div", { className: "btn-row", style: "margin-top:16px" },
            h("a", { href: `#/contracts/${cn}/projects/edit/${rn}`, className: "btn btn-primary btn-small", style: "text-decoration:none" }, "Edit Project"),
            h("button", { className: "btn btn-danger", onclick: async () => {
                if (confirm(`Delete project ${p.name}? This will remove the OpenStack project and all its resources. This cannot be undone.`)) {
                    try {
                        await api(`/api/contracts/${contractNumber}/projects/${resourceName}`, { method: "DELETE" });
                        navigate(`/contracts/${cn}/projects`);
                    } catch (err) { showAlert(err.message); }
                }
            }}, "Delete Project"),
        ));
    } catch (e) { showAlert(e.message); }
}

function renderCreateProject(contractNumber) {
    clear(app);
    const contractInfo = currentUser.contracts.find(c => c.contract_number === contractNumber);
    const customerDomain = contractInfo ? contractInfo.customer.domain : "";
    const cn = encodeURIComponent(contractNumber);

    app.appendChild(breadcrumbs(
        { label: "My Contracts", hash: "contracts" },
        { label: contractNumber, hash: `contracts/${cn}/projects` },
        { label: "New Project" },
    ));
    app.appendChild(h("h2", {}, "New Project"));

    const form = h("form", { className: "form-card", onsubmit: async (e) => {
        e.preventDefault();
        const name = form.querySelector('[name="name"]').value.trim();
        const description = form.querySelector('[name="description"]').value.trim();
        const usersRaw = form.querySelector('[name="users"]').value.trim();
        const users = usersRaw ? usersRaw.split("\n").map(u => u.trim()).filter(Boolean) : [];
        try {
            await api(`/api/contracts/${contractNumber}/projects`, {
                method: "POST", body: JSON.stringify({ name, description, users }),
            });
            navigate(`/contracts/${cn}/projects`);
        } catch (err) { showAlert(err.message); }
    }},
        h("label", {}, "Project name"),
        h("div", { className: "input-with-suffix" },
            h("input", { name: "name", required: "true", maxlength: "64", placeholder: "my-project", pattern: "[a-z0-9]([a-z0-9-]*[a-z0-9])?" }),
            customerDomain ? h("span", { className: "input-suffix" }, "." + customerDomain) : null,
        ),
        h("label", {}, "Description"),
        h("input", { name: "description", placeholder: "Optional description" }),
        h("label", {}, "Users (one identifier per line)"),
        h("textarea", { name: "users", placeholder: "user1@idp\nuser2@idp" }),
        h("div", { className: "btn-row" },
            h("a", { href: `#/contracts/${cn}/projects`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Cancel"),
            h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Create Project"),
        ),
    );
    app.appendChild(form);
}

async function renderEditProject(contractNumber, resourceName) {
    clear(app);
    const cn = encodeURIComponent(contractNumber);
    const rn = encodeURIComponent(resourceName);

    app.appendChild(breadcrumbs(
        { label: "My Contracts", hash: "contracts" },
        { label: contractNumber, hash: `contracts/${cn}/projects` },
        { label: resourceName, hash: `contracts/${cn}/projects/${rn}` },
        { label: "Edit" },
    ));
    app.appendChild(h("h2", {}, "Edit Project"));

    try {
        const p = await api(`/api/contracts/${contractNumber}/projects/${resourceName}`);
        const form = h("form", { className: "form-card", onsubmit: async (e) => {
            e.preventDefault();
            const description = form.querySelector('[name="description"]').value.trim();
            const usersRaw = form.querySelector('[name="users"]').value.trim();
            const users = usersRaw ? usersRaw.split("\n").map(u => u.trim()).filter(Boolean) : [];
            try {
                await api(`/api/contracts/${contractNumber}/projects/${resourceName}`, {
                    method: "PATCH", body: JSON.stringify({ description, users }),
                });
                navigate(`/contracts/${cn}/projects/${rn}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", {}, "Project name"),
            h("input", { value: p.name, disabled: "true" }),
            h("label", {}, "Description"),
            h("input", { name: "description", value: p.description, placeholder: "Optional description" }),
            h("label", {}, "Users (one identifier per line)"),
            h("textarea", { name: "users" }, p.users.join("\n")),
            h("div", { className: "btn-row" },
                h("a", { href: `#/contracts/${cn}/projects/${rn}`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Cancel"),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Save Changes"),
            ),
        );
        app.appendChild(form);
    } catch (e) { showAlert(e.message); }
}

// ========== ADMIN VIEWS ==========

async function renderAdminCustomers() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Customers" }));
    app.appendChild(h("h2", {}, "Customers"));
    app.appendChild(h("p", { className: "page-desc" }, "Manage customer organisations and their contracts."));

    const form = h("form", { onsubmit: async (e) => {
        e.preventDefault();
        const name = form.querySelector('[name="name"]').value.trim();
        const domain = form.querySelector('[name="domain"]').value.trim();
        const description = form.querySelector('[name="description"]').value.trim();
        try {
            await api("/api/admin/customers", { method: "POST", body: JSON.stringify({ name, domain, description }) });
            navigate("/admin");
        } catch (err) { showAlert(err.message); }
    }},
        h("div", { className: "form-card" },
            h("h3", {}, "Add Customer"),
            h("div", { className: "form-row" },
                h("div", {}, h("label", {}, "Name"), h("input", { name: "name", required: "true", placeholder: "Organisation name" })),
                h("div", {}, h("label", {}, "Domain"), h("input", { name: "domain", required: "true", placeholder: "example.se", pattern: "[a-z0-9.-]+" })),
            ),
            h("label", {}, "Description"),
            h("input", { name: "description", placeholder: "Optional" }),
            h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Add Customer"),
        ),
    );
    app.appendChild(form);
    app.appendChild(h("div", { className: "section-label" }, "Existing Customers"));

    try {
        const customers = await api("/api/admin/customers");
        if (!customers.length) { app.appendChild(h("p", { className: "empty" }, "No customers yet.")); return; }
        for (const c of customers) {
            app.appendChild(
                h("a", { href: `#/admin/customers/${c.id}`, className: "card card-clickable", style: "display:block;text-decoration:none;color:inherit" },
                    h("div", { className: "card-header" }, h("h3", {}, c.name), h("span", { className: "badge badge-neutral" }, c.domain)),
                    c.description ? h("p", { className: "meta" }, c.description) : null,
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

async function renderAdminCustomerDetail(customerId) {
    clear(app);
    try {
        const customer = await api(`/api/admin/customers/${customerId}`);
        app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Customers", hash: "admin" }, { label: customer.name }));
        app.appendChild(h("h2", {}, customer.name));
        const descParts = [customer.domain];
        if (customer.description) descParts.push(customer.description);
        app.appendChild(h("p", { className: "page-desc" }, descParts.join(" — ")));

        app.appendChild(h("div", { className: "btn-row", style: "margin-bottom:20px" },
            h("a", { href: `#/admin/customers/edit/${customerId}`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Edit Customer"),
            h("button", { className: "btn btn-danger", onclick: async () => {
                if (confirm(`Delete customer ${customer.name}? All contracts must be deleted first.`)) {
                    try { await api(`/api/admin/customers/${customerId}`, { method: "DELETE" }); navigate("/admin"); }
                    catch (err) { showAlert(err.message); }
                }
            }}, "Delete Customer"),
        ));

        app.appendChild(h("div", { className: "section-label" }, "Add Contract"));
        const form = h("form", { onsubmit: async (e) => {
            e.preventDefault();
            const cn = form.querySelector('[name="contract_number"]').value.trim();
            const desc = form.querySelector('[name="description"]').value.trim();
            try {
                await api("/api/admin/contracts", { method: "POST", body: JSON.stringify({ customer_id: customerId, contract_number: cn, description: desc }) });
                navigate(`/admin/customers/${customerId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("div", { className: "form-card" },
                h("div", { className: "form-row" },
                    h("div", {}, h("label", {}, "Contract Number"), h("input", { name: "contract_number", required: "true", placeholder: "SD-123-a", pattern: "[A-Za-z0-9-]+" })),
                    h("div", {}, h("label", {}, "Description"), h("input", { name: "description", placeholder: "Optional" })),
                ),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Add Contract"),
            ),
        );
        app.appendChild(form);

        app.appendChild(h("div", { className: "section-label" }, "Contracts"));
        if (!customer.contracts.length) app.appendChild(h("p", { className: "empty" }, "No contracts yet."));
        for (const c of customer.contracts) {
            app.appendChild(
                h("a", { href: `#/admin/contracts/${c.id}`, className: "card card-clickable", style: "display:block;text-decoration:none;color:inherit" },
                    h("div", { className: "card-header" }, h("h3", {}, c.contract_number)),
                    c.description ? h("p", { className: "meta" }, c.description) : null,
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

async function renderAdminEditCustomer(customerId) {
    clear(app);
    try {
        const customer = await api(`/api/admin/customers/${customerId}`);
        app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Customers", hash: "admin" }, { label: customer.name, hash: `admin/customers/${customerId}` }, { label: "Edit" }));
        app.appendChild(h("h2", {}, "Edit Customer"));

        const form = h("form", { className: "form-card", onsubmit: async (e) => {
            e.preventDefault();
            const name = form.querySelector('[name="name"]').value.trim();
            const domain = form.querySelector('[name="domain"]').value.trim();
            const description = form.querySelector('[name="description"]').value.trim();
            try {
                await api(`/api/admin/customers/${customerId}`, { method: "PATCH", body: JSON.stringify({ name, domain, description }) });
                navigate(`/admin/customers/${customerId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", {}, "Name"),
            h("input", { name: "name", required: "true", value: customer.name }),
            h("label", {}, "Domain"),
            h("input", { name: "domain", required: "true", value: customer.domain, pattern: "[a-z0-9.-]+" }),
            h("label", {}, "Description"),
            h("input", { name: "description", value: customer.description }),
            h("div", { className: "btn-row" },
                h("a", { href: `#/admin/customers/${customerId}`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Cancel"),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Save Changes"),
            ),
        );
        app.appendChild(form);
    } catch (e) { showAlert(e.message); }
}

async function renderAdminContractDetail(contractId) {
    clear(app);
    try {
        const contract = await api(`/api/admin/contracts/${contractId}`);
        app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Customers", hash: "admin" }, { label: contract.customer.name, hash: `admin/customers/${contract.customer.id}` }, { label: contract.contract_number }));
        app.appendChild(h("h2", {}, contract.contract_number));
        const descParts = [contract.customer.name, contract.customer.domain];
        if (contract.description) descParts.push(contract.description);
        app.appendChild(h("p", { className: "page-desc" }, descParts.join(" — ")));

        app.appendChild(h("div", { className: "btn-row", style: "margin-bottom:20px" },
            h("a", { href: `#/admin/contracts/edit/${contractId}`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Edit Contract"),
            h("button", { className: "btn btn-danger", onclick: async () => {
                if (confirm(`Delete contract ${contract.contract_number}? All projects must be deleted first.`)) {
                    try { await api(`/api/admin/contracts/${contractId}`, { method: "DELETE" }); navigate(`/admin/customers/${contract.customer.id}`); }
                    catch (err) { showAlert(err.message); }
                }
            }}, "Delete Contract"),
        ));

        // Rebate
        app.appendChild(h("div", { className: "section-label" }, "Rebate"));
        const rebateForm = h("form", { className: "form-card", onsubmit: async (e) => {
            e.preventDefault();
            const pct = rebateForm.querySelector('[name="rebate"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}/rebate`, { method: "PUT", body: JSON.stringify({ rebate_percent: parseFloat(pct) }) });
                navigate(`/admin/contracts/${contractId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("div", { className: "form-row" },
                h("div", {},
                    h("label", {}, "Rebate (%)"),
                    h("input", { name: "rebate", type: "number", min: "0", max: "100", step: "0.01", value: contract.rebate_percent != null ? contract.rebate_percent : "" }),
                ),
                h("div", { style: "display:flex;align-items:flex-end;gap:8px;padding-bottom:12px" },
                    h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Set Rebate"),
                    contract.rebate_percent != null ? h("button", { type: "button", className: "btn btn-danger", onclick: async () => {
                        try { await api(`/api/admin/contracts/${contractId}/rebate`, { method: "DELETE" }); navigate(`/admin/contracts/${contractId}`); }
                        catch (err) { showAlert(err.message); }
                    }}, "Remove") : null,
                ),
            ),
        );
        app.appendChild(rebateForm);

        // Price overrides
        app.appendChild(h("div", { className: "section-label" }, "Price Overrides"));
        try {
            const overrides = await api(`/api/admin/contracts/${contractId}/pricing`);
            if (overrides.length) {
                const ul = h("ul", { className: "user-list" });
                for (const o of overrides) {
                    ul.appendChild(h("li", {},
                        h("span", { className: "user-sub" }, `${o.resource_type}: ${o.unit_price} SEK`),
                        h("button", { className: "btn btn-danger", onclick: async () => {
                            await api(`/api/admin/contracts/${contractId}/pricing/${encodeURIComponent(o.resource_type)}`, { method: "DELETE" });
                            navigate(`/admin/contracts/${contractId}`);
                        }}, "Remove"),
                    ));
                }
                app.appendChild(ul);
            } else {
                app.appendChild(h("p", { className: "meta", style: "margin-bottom:8px" }, "Using global default prices."));
            }
        } catch (e) { /* ignore */ }

        // Fetch global prices for the dropdown
        let globalPrices = [];
        try { globalPrices = await api("/api/admin/pricing"); } catch (e) { /* ignore */ }

        if (globalPrices.length) {
            const select = h("select", { name: "resource_type", required: "true" },
                h("option", { value: "" }, "-- Select resource type --"),
                ...globalPrices.map(p => h("option", { value: p.resource_type }, `${p.resource_type} (${p.unit_price} SEK / ${p.unit})`)),
            );
            const priceForm = h("form", { className: "form-card", onsubmit: async (e) => {
                e.preventDefault();
                const rt = priceForm.querySelector('[name="resource_type"]').value;
                const price = priceForm.querySelector('[name="unit_price"]').value.trim();
                if (!rt) return;
                try {
                    await api(`/api/admin/contracts/${contractId}/pricing/${encodeURIComponent(rt)}`, {
                        method: "PUT", body: JSON.stringify({ resource_type: rt, unit_price: parseFloat(price) }),
                    });
                    navigate(`/admin/contracts/${contractId}`);
                } catch (err) { showAlert(err.message); }
            }},
                h("div", { className: "form-row" },
                    h("div", {}, h("label", {}, "Resource type"), select),
                    h("div", {}, h("label", {}, "Override price (SEK)"), h("input", { name: "unit_price", type: "number", min: "0", step: "0.01", required: "true" })),
                ),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Add Override"),
            );
            app.appendChild(priceForm);
        } else {
            app.appendChild(h("p", { className: "meta" }, "Configure global prices first (Admin > Pricing) before adding overrides."));
        }

        // Grant access
        app.appendChild(h("div", { className: "section-label" }, "Grant Access"));
        const accessForm = h("form", { onsubmit: async (e) => {
            e.preventDefault();
            const sub = accessForm.querySelector('[name="user_sub"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}/users`, { method: "POST", body: JSON.stringify({ user_sub: sub }) });
                navigate(`/admin/contracts/${contractId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("div", { className: "form-card" },
                h("div", { className: "form-row" },
                    h("div", {}, h("label", {}, "User identifier"), h("input", { name: "user_sub", required: "true", placeholder: "username@idp" })),
                    h("div", { style: "display:flex;align-items:flex-end;padding-bottom:12px" },
                        h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Grant Access"),
                    ),
                ),
            ),
        );
        app.appendChild(accessForm);

        // Authorized users
        app.appendChild(h("div", { className: "section-label" }, "Authorized Users"));
        if (!contract.users.length) {
            app.appendChild(h("p", { className: "empty" }, "No users have access yet."));
        } else {
            const ul = h("ul", { className: "user-list" });
            for (const userSub of contract.users) {
                ul.appendChild(h("li", {},
                    h("span", { className: "user-sub" }, userSub),
                    h("button", { className: "btn btn-danger", onclick: async (e) => {
                        e.stopPropagation();
                        if (confirm(`Revoke access for ${userSub}?`)) {
                            await api(`/api/admin/contracts/${contractId}/users/${encodeURIComponent(userSub)}`, { method: "DELETE" });
                            navigate(`/admin/contracts/${contractId}`);
                        }
                    }}, "Revoke"),
                ));
            }
            app.appendChild(ul);
        }
    } catch (e) { showAlert(e.message); }
}

async function renderAdminEditContract(contractId) {
    clear(app);
    try {
        const contract = await api(`/api/admin/contracts/${contractId}`);
        app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Customers", hash: "admin" }, { label: contract.customer.name, hash: `admin/customers/${contract.customer.id}` }, { label: contract.contract_number, hash: `admin/contracts/${contractId}` }, { label: "Edit" }));
        app.appendChild(h("h2", {}, "Edit Contract"));

        const form = h("form", { className: "form-card", onsubmit: async (e) => {
            e.preventDefault();
            const description = form.querySelector('[name="description"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}`, { method: "PATCH", body: JSON.stringify({ description }) });
                navigate(`/admin/contracts/${contractId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", {}, "Contract number"),
            h("input", { value: contract.contract_number, disabled: "true" }),
            h("label", {}, "Description"),
            h("input", { name: "description", value: contract.description }),
            h("div", { className: "btn-row" },
                h("a", { href: `#/admin/contracts/${contractId}`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Cancel"),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Save Changes"),
            ),
        );
        app.appendChild(form);
    } catch (e) { showAlert(e.message); }
}

// --- Admin: Global Pricing ---

async function renderAdminPricing() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Pricing" }));
    app.appendChild(h("h2", {}, "Global Pricing"));
    app.appendChild(h("p", { className: "page-desc" }, "Set default prices per resource type. Contracts can override these individually."));

    try {
        const prices = await api("/api/admin/pricing");
        if (prices.length) {
            const ul = h("ul", { className: "user-list" });
            for (const p of prices) {
                ul.appendChild(h("li", {},
                    h("span", { className: "user-sub" }, `${p.resource_type}: ${p.unit_price} SEK / ${p.unit}`),
                    h("button", { className: "btn btn-danger", onclick: async () => {
                        await api(`/api/admin/pricing/${encodeURIComponent(p.resource_type)}`, { method: "DELETE" });
                        navigate("/admin/pricing");
                    }}, "Remove"),
                ));
            }
            app.appendChild(ul);
        } else {
            app.appendChild(h("p", { className: "empty" }, "No prices configured yet."));
        }
    } catch (e) { showAlert(e.message); }

    app.appendChild(h("div", { className: "section-label" }, "Add Price"));

    // Fetch available metrics from CloudKitty
    let metrics = [];
    try { metrics = await api("/api/admin/pricing/metrics"); } catch (e) { /* ignore */ }

    // Build a map of metric_type -> unit from CloudKitty
    const metricUnits = {};
    for (const m of metrics) metricUnits[m.metric_type] = m.unit || "";

    const unitInput = h("input", { name: "unit", required: "true", readonly: metrics.length ? "true" : undefined, placeholder: "unit" });

    const metricSelect = metrics.length
        ? h("select", { name: "resource_type", required: "true", onchange: (e) => {
            unitInput.value = metricUnits[e.target.value] || "";
          }},
            h("option", { value: "" }, "-- Select metric --"),
            ...metrics.map(m => h("option", { value: m.metric_type }, `${m.metric_type} (${m.unit})`)),
          )
        : h("input", { name: "resource_type", required: "true", placeholder: "metric type (CloudKitty unavailable)" });

    const form = h("form", { className: "form-card", onsubmit: async (e) => {
        e.preventDefault();
        const rt = form.querySelector('[name="resource_type"]').value.trim();
        const price = form.querySelector('[name="unit_price"]').value.trim();
        const unit = form.querySelector('[name="unit"]').value.trim();
        if (!rt || !unit) return;
        try {
            await api(`/api/admin/pricing/${encodeURIComponent(rt)}`, {
                method: "PUT", body: JSON.stringify({ resource_type: rt, unit_price: parseFloat(price), unit }),
            });
            navigate("/admin/pricing");
        } catch (err) { showAlert(err.message); }
    }},
        h("div", { className: "form-row" },
            h("div", {}, h("label", {}, "Resource type"), metricSelect),
            h("div", {}, h("label", {}, "Unit"), unitInput),
        ),
        h("label", {}, "Unit price (SEK)"),
        h("input", { name: "unit_price", type: "number", min: "0", step: "0.01", required: "true", placeholder: "0.00" }),
        h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Set Price"),
    );
    app.appendChild(form);

    if (!metrics.length) {
        app.appendChild(h("p", { className: "meta" }, "Could not connect to CloudKitty to discover available metrics. You can enter metric types manually."));
    }
}

// ========== BILLING VIEWS ==========

async function renderBillingJobs() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "Billing" }));
    app.appendChild(h("h2", {}, "Billing Jobs"));
    app.appendChild(h("p", { className: "page-desc" }, "Automated billing exports delivered to WebDAV or email on a schedule."));
    app.appendChild(h("a", { href: "#/billing/new", className: "btn btn-primary btn-small", style: "display:inline-block;margin-bottom:16px;text-decoration:none" }, "+ New Billing Job"));

    try {
        const jobs = await api("/api/billing/jobs");
        if (!jobs.length) {
            app.appendChild(h("p", { className: "empty" }, "No billing jobs configured yet."));
            return;
        }
        for (const j of jobs) {
            app.appendChild(
                h("a", { href: `#/billing/${j.id}`, className: "card card-clickable", style: "display:block;text-decoration:none;color:inherit" },
                    h("div", { className: "card-header" },
                        h("h3", {}, j.name),
                        h("span", { className: j.enabled ? "badge badge-ready" : "badge badge-neutral" }, j.enabled ? "Enabled" : "Disabled"),
                    ),
                    h("p", { className: "meta" }, `${j.delivery_method} — ${j.schedule} — ${j.all_contracts ? "all contracts" : j.contract_ids.length + " contracts"}`),
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

async function renderBillingJobDetail(jobId) {
    clear(app);
    try {
        const job = await api(`/api/billing/jobs/${jobId}`);
        app.appendChild(breadcrumbs({ label: "Billing", hash: "billing" }, { label: job.name }));
        app.appendChild(h("h2", {}, job.name));

        app.appendChild(h("div", { className: "card" },
            h("div", { className: "card-header" },
                h("div", { className: "section-label", style: "margin:0" }, "Status"),
                h("span", { className: job.enabled ? "badge badge-ready" : "badge badge-neutral" }, job.enabled ? "Enabled" : "Disabled"),
            ),
            h("div", { className: "section-label" }, "Schedule"),
            h("p", {}, job.schedule),
            h("div", { className: "section-label" }, "Delivery"),
            h("p", {}, job.delivery_method === "webdav" ? `WebDAV: ${job.delivery_config.url || ""}` : `Email: ${job.delivery_config.recipient || ""}`),
            h("div", { className: "section-label" }, "Filename Template"),
            h("p", {}, job.filename_template),
            h("div", { className: "section-label" }, "Output Mode"),
            h("p", {}, job.per_contract ? "One file per contract" : "Single file"),
            h("div", { className: "section-label" }, "Contracts"),
            h("p", {}, job.all_contracts ? "All accessible contracts" : `${job.contract_ids.length} selected`),
        ));

        app.appendChild(h("div", { className: "btn-row", style: "margin-top:16px;margin-bottom:20px" },
            h("a", { href: `#/billing/${jobId}/edit`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Edit"),
            h("button", { className: "btn btn-primary btn-small", onclick: async () => {
                try {
                    const run = await api(`/api/billing/jobs/${jobId}/run`, { method: "POST", body: JSON.stringify({}) });
                    showAlert(`Run completed: ${run.status}${run.files_delivered ? ", " + run.files_delivered + " files delivered" : ""}`, run.status === "success" ? "success" : "error");
                    navigate(`/billing/${jobId}`);
                } catch (err) { showAlert(err.message); }
            }}, "Run Now"),
            h("button", { className: "btn btn-danger", onclick: async () => {
                if (confirm(`Delete billing job "${job.name}"?`)) {
                    await api(`/api/billing/jobs/${jobId}`, { method: "DELETE" });
                    navigate("/billing");
                }
            }}, "Delete"),
        ));

        // Execution history
        app.appendChild(h("div", { className: "section-label" }, "Execution History"));
        const runs = await api(`/api/billing/jobs/${jobId}/runs`);
        if (!runs.length) {
            app.appendChild(h("p", { className: "empty" }, "No executions yet."));
        } else {
            for (const r of runs) {
                const statusClass = r.status === "success" ? "badge-ready" : r.status === "error" ? "badge-error" : "badge-pending";
                app.appendChild(h("div", { className: "card" },
                    h("div", { className: "card-header" },
                        h("span", {}, new Date(r.started_at).toLocaleString()),
                        h("span", { className: `badge ${statusClass}` }, r.status),
                    ),
                    h("p", { className: "meta" },
                        `Period: ${r.billing_period_start.substring(0, 10)} to ${r.billing_period_end.substring(0, 10)}` +
                        (r.files_delivered ? ` — ${r.files_delivered} files delivered` : ""),
                    ),
                    r.error_message ? h("p", { className: "meta", style: "color:var(--error)" }, r.error_message) : null,
                ));
            }
        }
    } catch (e) { showAlert(e.message); }
}

async function renderCreateBillingJob() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "Billing", hash: "billing" }, { label: "New Job" }));
    app.appendChild(h("h2", {}, "New Billing Job"));

    // Fetch user's contracts for selection
    const user = currentUser;
    const contracts = user.contracts || [];

    const form = h("form", { className: "form-card", onsubmit: async (e) => {
        e.preventDefault();
        const name = form.querySelector('[name="name"]').value.trim();
        const schedule = form.querySelector('[name="schedule"]').value.trim();
        const allContracts = form.querySelector('[name="all_contracts"]').checked;
        const deliveryMethod = form.querySelector('[name="delivery_method"]').value;
        const filenameTemplate = form.querySelector('[name="filename_template"]').value.trim();
        const perContract = form.querySelector('[name="per_contract"]').checked;

        const deliveryConfig = {};
        if (deliveryMethod === "webdav") {
            deliveryConfig.url = form.querySelector('[name="webdav_url"]').value.trim();
            deliveryConfig.username = form.querySelector('[name="webdav_username"]').value.trim();
            deliveryConfig.password = form.querySelector('[name="webdav_password"]').value;
        } else {
            deliveryConfig.recipient = form.querySelector('[name="email_recipient"]').value.trim();
        }

        const contractIds = [];
        if (!allContracts) {
            form.querySelectorAll('[name="contract_id"]:checked').forEach(cb => contractIds.push(parseInt(cb.value)));
        }

        try {
            await api("/api/billing/jobs", {
                method: "POST",
                body: JSON.stringify({ name, schedule, all_contracts: allContracts, contract_ids: contractIds, delivery_method: deliveryMethod, delivery_config: deliveryConfig, filename_template: filenameTemplate, per_contract: perContract }),
            });
            navigate("/billing");
        } catch (err) { showAlert(err.message); }
    }},
        h("label", {}, "Job name"),
        h("input", { name: "name", required: "true", placeholder: "Monthly billing export" }),

        h("label", {}, "Schedule (cron expression)"),
        h("input", { name: "schedule", required: "true", placeholder: "0 6 1 * *", value: "0 6 1 * *" }),
        h("p", { className: "meta", style: "margin-top:-8px;margin-bottom:12px" }, "e.g. 0 6 1 * * = 1st of each month at 06:00 UTC"),

        h("label", {}, "Contracts"),
        h("div", { style: "margin-bottom:12px" },
            h("label", { style: "display:inline;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text)" },
                h("input", { type: "checkbox", name: "all_contracts", checked: "true", style: "width:auto;margin-right:6px" }),
                "All my contracts",
            ),
        ),
        h("div", { id: "contract-checkboxes", style: "margin-bottom:12px" },
            ...contracts.map(c =>
                h("label", { style: "display:block;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text);padding:4px 0" },
                    h("input", { type: "checkbox", name: "contract_id", value: String(c.id), style: "width:auto;margin-right:6px" }),
                    c.contract_number + " (" + c.customer.name + ")",
                )
            ),
        ),

        h("label", {}, "Delivery method"),
        h("select", { name: "delivery_method", onchange: (e) => {
            const webdav = form.querySelector("#webdav-config");
            const email = form.querySelector("#email-config");
            webdav.style.display = e.target.value === "webdav" ? "block" : "none";
            email.style.display = e.target.value === "email" ? "block" : "none";
        }},
            h("option", { value: "webdav" }, "WebDAV"),
            h("option", { value: "email" }, "Email"),
        ),

        h("div", { id: "webdav-config" },
            h("label", {}, "WebDAV URL"),
            h("input", { name: "webdav_url", placeholder: "https://webdav.example.se/billing/" }),
            h("div", { className: "form-row" },
                h("div", {}, h("label", {}, "Username"), h("input", { name: "webdav_username" })),
                h("div", {}, h("label", {}, "Password"), h("input", { name: "webdav_password", type: "password" })),
            ),
        ),
        h("div", { id: "email-config", style: "display:none" },
            h("label", {}, "Recipient"),
            h("input", { name: "email_recipient", placeholder: "billing@example.se" }),
        ),

        h("label", {}, "Filename template"),
        h("input", { name: "filename_template", value: "billing-{year}-{month}.csv" }),
        h("p", { className: "meta", style: "margin-top:-8px;margin-bottom:12px" }, "Variables: {year}, {month}, {day}, {date}, {contract}"),

        h("div", { style: "margin-bottom:16px" },
            h("label", { style: "display:inline;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text)" },
                h("input", { type: "checkbox", name: "per_contract", style: "width:auto;margin-right:6px" }),
                "Generate one file per contract",
            ),
        ),

        h("div", { className: "btn-row" },
            h("a", { href: "#/billing", className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Cancel"),
            h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Create Job"),
        ),
    );
    app.appendChild(form);
}

async function renderEditBillingJob(jobId) {
    clear(app);
    try {
        const job = await api(`/api/billing/jobs/${jobId}`);
        app.appendChild(breadcrumbs({ label: "Billing", hash: "billing" }, { label: job.name, hash: `billing/${jobId}` }, { label: "Edit" }));
        app.appendChild(h("h2", {}, "Edit Billing Job"));

        const contracts = currentUser.contracts || [];

        const form = h("form", { className: "form-card", onsubmit: async (e) => {
            e.preventDefault();
            const name = form.querySelector('[name="name"]').value.trim();
            const schedule = form.querySelector('[name="schedule"]').value.trim();
            const allContracts = form.querySelector('[name="all_contracts"]').checked;
            const deliveryMethod = form.querySelector('[name="delivery_method"]').value;
            const filenameTemplate = form.querySelector('[name="filename_template"]').value.trim();
            const perContract = form.querySelector('[name="per_contract"]').checked;
            const enabled = form.querySelector('[name="enabled"]').checked;

            const deliveryConfig = {};
            if (deliveryMethod === "webdav") {
                deliveryConfig.url = form.querySelector('[name="webdav_url"]').value.trim();
                deliveryConfig.username = form.querySelector('[name="webdav_username"]').value.trim();
                deliveryConfig.password = form.querySelector('[name="webdav_password"]').value || "********";
            } else {
                deliveryConfig.recipient = form.querySelector('[name="email_recipient"]').value.trim();
            }

            const contractIds = [];
            if (!allContracts) {
                form.querySelectorAll('[name="contract_id"]:checked').forEach(cb => contractIds.push(parseInt(cb.value)));
            }

            try {
                await api(`/api/billing/jobs/${jobId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name, schedule, all_contracts: allContracts, contract_ids: contractIds, delivery_method: deliveryMethod, delivery_config: deliveryConfig, filename_template: filenameTemplate, per_contract: perContract, enabled }),
                });
                navigate(`/billing/${jobId}`);
            } catch (err) { showAlert(err.message); }
        }},
            h("label", {}, "Job name"),
            h("input", { name: "name", required: "true", value: job.name }),

            h("label", {}, "Schedule (cron expression)"),
            h("input", { name: "schedule", required: "true", value: job.schedule }),

            h("div", { style: "margin-bottom:12px" },
                h("label", { style: "display:inline;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text)" },
                    h("input", { type: "checkbox", name: "all_contracts", style: "width:auto;margin-right:6px", ...(job.all_contracts ? { checked: "true" } : {}) }),
                    "All my contracts",
                ),
            ),
            h("div", { style: "margin-bottom:12px" },
                ...contracts.map(c =>
                    h("label", { style: "display:block;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text);padding:4px 0" },
                        h("input", { type: "checkbox", name: "contract_id", value: String(c.id), style: "width:auto;margin-right:6px", ...(job.contract_ids.includes(c.id) ? { checked: "true" } : {}) }),
                        c.contract_number + " (" + c.customer.name + ")",
                    )
                ),
            ),

            h("label", {}, "Delivery method"),
            h("select", { name: "delivery_method", onchange: (e) => {
                form.querySelector("#webdav-config").style.display = e.target.value === "webdav" ? "block" : "none";
                form.querySelector("#email-config").style.display = e.target.value === "email" ? "block" : "none";
            }},
                h("option", { value: "webdav", ...(job.delivery_method === "webdav" ? { selected: "true" } : {}) }, "WebDAV"),
                h("option", { value: "email", ...(job.delivery_method === "email" ? { selected: "true" } : {}) }, "Email"),
            ),

            h("div", { id: "webdav-config", style: job.delivery_method === "webdav" ? "" : "display:none" },
                h("label", {}, "WebDAV URL"),
                h("input", { name: "webdav_url", value: (job.delivery_config.url || "") }),
                h("div", { className: "form-row" },
                    h("div", {}, h("label", {}, "Username"), h("input", { name: "webdav_username", value: (job.delivery_config.username || "") })),
                    h("div", {}, h("label", {}, "Password"), h("input", { name: "webdav_password", type: "password", placeholder: "Leave blank to keep current" })),
                ),
            ),
            h("div", { id: "email-config", style: job.delivery_method === "email" ? "" : "display:none" },
                h("label", {}, "Recipient"),
                h("input", { name: "email_recipient", value: (job.delivery_config.recipient || "") }),
            ),

            h("label", {}, "Filename template"),
            h("input", { name: "filename_template", value: job.filename_template }),

            h("div", { style: "margin-bottom:12px" },
                h("label", { style: "display:inline;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text)" },
                    h("input", { type: "checkbox", name: "per_contract", style: "width:auto;margin-right:6px", ...(job.per_contract ? { checked: "true" } : {}) }),
                    "One file per contract",
                ),
            ),
            h("div", { style: "margin-bottom:16px" },
                h("label", { style: "display:inline;font-weight:normal;text-transform:none;letter-spacing:normal;color:var(--text)" },
                    h("input", { type: "checkbox", name: "enabled", style: "width:auto;margin-right:6px", ...(job.enabled ? { checked: "true" } : {}) }),
                    "Enabled",
                ),
            ),

            h("div", { className: "btn-row" },
                h("a", { href: `#/billing/${jobId}`, className: "btn btn-secondary btn-small", style: "text-decoration:none" }, "Cancel"),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Save Changes"),
            ),
        );
        app.appendChild(form);
    } catch (e) { showAlert(e.message); }
}

async function renderAdminBillingJobs() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "Admin" }, { label: "Billing Jobs" }));
    app.appendChild(h("h2", {}, "All Billing Jobs"));
    app.appendChild(h("p", { className: "page-desc" }, "All billing jobs across all users."));

    try {
        const jobs = await api("/api/billing/jobs?all=true");
        if (!jobs.length) {
            app.appendChild(h("p", { className: "empty" }, "No billing jobs configured."));
            return;
        }
        for (const j of jobs) {
            app.appendChild(
                h("a", { href: `#/billing/${j.id}`, className: "card card-clickable", style: "display:block;text-decoration:none;color:inherit" },
                    h("div", { className: "card-header" },
                        h("h3", {}, j.name),
                        h("span", { className: j.enabled ? "badge badge-ready" : "badge badge-neutral" }, j.enabled ? "Enabled" : "Disabled"),
                    ),
                    h("p", { className: "meta" }, `Owner: ${j.owner_sub} — ${j.delivery_method} — ${j.schedule}`),
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

// --- Init ---

route();
