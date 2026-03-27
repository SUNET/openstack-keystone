/* SUNET Cloud Portal — vanilla JS SPA */

const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const nav = $("#nav");

let currentUser = null;

// --- API helpers ---

async function api(path, opts = {}) {
    const resp = await fetch(path, {
        headers: { "Content-Type": "application/json", ...opts.headers },
        ...opts,
    });
    if (resp.status === 401) {
        currentUser = null;
        renderLogin();
        return null;
    }
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
        if (k === "onclick") el.addEventListener("click", v);
        else if (k === "onsubmit") el.addEventListener("submit", v);
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
    // items: [{label, onclick?}, ...] — last item is current (no link)
    const bc = h("nav", { className: "breadcrumbs" });
    items.forEach((item, i) => {
        if (i > 0) bc.appendChild(h("span", { className: "sep" }, "/"));
        if (i < items.length - 1 && item.onclick) {
            bc.appendChild(h("a", { href: "#", onclick: (e) => { e.preventDefault(); item.onclick(); } }, item.label));
        } else {
            bc.appendChild(h("span", { className: "current" }, item.label));
        }
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
    nav.appendChild(h("a", { href: "#", onclick: (e) => { e.preventDefault(); renderContracts(); } }, "My Contracts"));
    if (currentUser.is_admin) {
        nav.appendChild(h("a", { href: "#", onclick: (e) => { e.preventDefault(); renderAdminCustomers(); } }, "Admin"));
    }
    nav.appendChild(h("a", { href: "#", className: "nav-user" }, currentUser.email || currentUser.sub));
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

// --- Customer views: Contracts ---

async function renderContracts() {
    clear(app);
    app.appendChild(breadcrumbs({ label: "My Contracts" }));
    app.appendChild(h("h2", {}, "My Contracts"));
    app.appendChild(h("p", { className: "page-desc" }, "Select a contract to view and manage its projects."));

    try {
        const user = await api("/api/me");
        currentUser = user;
        renderNav();
        if (!user.contracts.length) {
            app.appendChild(h("p", { className: "empty" }, "You don't have access to any contracts yet. Ask an administrator to grant you access."));
            return;
        }
        for (const c of user.contracts) {
            app.appendChild(
                h("div", { className: "card card-clickable", onclick: () => renderContractProjects(c.contract_number) },
                    h("div", { className: "card-header" },
                        h("h3", {}, c.contract_number),
                        h("span", { className: "badge badge-neutral" }, c.customer.domain),
                    ),
                    h("p", { className: "meta" }, c.customer.name + (c.description ? " — " + c.description : "")),
                )
            );
        }
    } catch (e) {
        showAlert(e.message);
    }
}

// --- Customer views: Projects under a contract ---

async function renderContractProjects(contractNumber) {
    clear(app);

    const contractInfo = currentUser.contracts.find(c => c.contract_number === contractNumber);
    const customerName = contractInfo ? contractInfo.customer.name : "";
    const customerDomain = contractInfo ? contractInfo.customer.domain : "";

    app.appendChild(breadcrumbs(
        { label: "My Contracts", onclick: renderContracts },
        { label: contractNumber },
    ));
    app.appendChild(h("h2", {}, "Projects"));
    app.appendChild(h("p", { className: "page-desc" }, customerName + " — " + contractNumber));

    app.appendChild(
        h("button", { className: "btn btn-primary btn-small", style: "margin-bottom:16px", onclick: () => renderCreateProject(contractNumber, customerDomain) }, "+ New Project")
    );

    try {
        const projects = await api(`/api/contracts/${contractNumber}/projects`);
        if (!projects.length) {
            app.appendChild(h("p", { className: "empty" }, "No projects yet. Create one to get started."));
            return;
        }
        for (const p of projects) {
            app.appendChild(
                h("div", { className: "card" },
                    h("div", { className: "card-header" },
                        h("h3", {}, p.name),
                        phaseBadge(p.phase),
                    ),
                    p.description ? h("p", { className: "meta" }, p.description) : null,
                    h("p", { className: "meta" }, "Users: " + p.users.join(", ")),
                )
            );
        }
    } catch (e) {
        showAlert(e.message);
    }
}

// --- Customer views: Create project ---

function renderCreateProject(contractNumber, customerDomain) {
    clear(app);

    app.appendChild(breadcrumbs(
        { label: "My Contracts", onclick: renderContracts },
        { label: contractNumber, onclick: () => renderContractProjects(contractNumber) },
        { label: "New Project" },
    ));
    app.appendChild(h("h2", {}, "New Project"));
    app.appendChild(h("p", { className: "page-desc" }, "Create a new project under contract " + contractNumber + "."));

    const form = h("form", { className: "form-card", onsubmit: async (e) => {
        e.preventDefault();
        const name = form.querySelector('[name="name"]').value.trim();
        const description = form.querySelector('[name="description"]').value.trim();
        const usersRaw = form.querySelector('[name="users"]').value.trim();
        const users = usersRaw ? usersRaw.split("\n").map(u => u.trim()).filter(Boolean) : [];

        try {
            await api(`/api/contracts/${contractNumber}/projects`, {
                method: "POST",
                body: JSON.stringify({ name, description, users }),
            });
            renderContractProjects(contractNumber);
        } catch (err) {
            showAlert(err.message);
        }
    }},
        h("label", { htmlFor: "name" }, "Project name"),
        h("div", { className: "input-with-suffix" },
            h("input", { name: "name", required: "true", maxlength: "64", placeholder: "my-project" }),
            customerDomain ? h("span", { className: "input-suffix" }, "." + customerDomain) : null,
        ),
        h("label", { htmlFor: "description" }, "Description"),
        h("input", { name: "description", placeholder: "Optional description" }),
        h("label", { htmlFor: "users" }, "Users (one email per line)"),
        h("textarea", { name: "users", placeholder: "user1@example.se\nuser2@example.se" }),
        h("div", { className: "btn-row" },
            h("button", { type: "button", className: "btn btn-secondary btn-small", onclick: () => renderContractProjects(contractNumber) }, "Cancel"),
            h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Create Project"),
        ),
    );
    app.appendChild(form);
}

// --- Admin views: Customers ---

async function renderAdminCustomers() {
    clear(app);
    app.appendChild(breadcrumbs(
        { label: "Admin" },
        { label: "Customers" },
    ));
    app.appendChild(h("h2", {}, "Customers"));
    app.appendChild(h("p", { className: "page-desc" }, "Manage customer organisations and their contracts."));

    const form = h("form", { onsubmit: async (e) => {
        e.preventDefault();
        const name = form.querySelector('[name="name"]').value.trim();
        const domain = form.querySelector('[name="domain"]').value.trim();
        const description = form.querySelector('[name="description"]').value.trim();
        try {
            await api("/api/admin/customers", {
                method: "POST",
                body: JSON.stringify({ name, domain, description }),
            });
            renderAdminCustomers();
        } catch (err) { showAlert(err.message); }
    }},
        h("div", { className: "form-card" },
            h("h3", {}, "Add Customer"),
            h("div", { className: "form-row" },
                h("div", {},
                    h("label", {}, "Name"),
                    h("input", { name: "name", required: "true", placeholder: "Organisation name" }),
                ),
                h("div", {},
                    h("label", {}, "Domain"),
                    h("input", { name: "domain", required: "true", placeholder: "example.se", pattern: "[a-z0-9.-]+" }),
                ),
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
        if (!customers.length) {
            app.appendChild(h("p", { className: "empty" }, "No customers yet."));
            return;
        }
        for (const c of customers) {
            app.appendChild(
                h("div", { className: "card card-clickable", onclick: () => renderAdminCustomerDetail(c.id) },
                    h("div", { className: "card-header" },
                        h("h3", {}, c.name),
                        h("span", { className: "badge badge-neutral" }, c.domain),
                    ),
                    c.description ? h("p", { className: "meta" }, c.description) : null,
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

// --- Admin views: Customer detail ---

async function renderAdminCustomerDetail(customerId) {
    clear(app);
    try {
        const customer = await api(`/api/admin/customers/${customerId}`);

        app.appendChild(breadcrumbs(
            { label: "Admin" },
            { label: "Customers", onclick: renderAdminCustomers },
            { label: customer.name },
        ));
        app.appendChild(h("h2", {}, customer.name));
        app.appendChild(h("p", { className: "page-desc" },
            customer.domain + (customer.description ? " — " + customer.description : ""),
        ));

        app.appendChild(h("div", { className: "section-label" }, "Add Contract"));

        const form = h("form", { onsubmit: async (e) => {
            e.preventDefault();
            const cn = form.querySelector('[name="contract_number"]').value.trim();
            const desc = form.querySelector('[name="description"]').value.trim();
            try {
                await api("/api/admin/contracts", {
                    method: "POST",
                    body: JSON.stringify({ customer_id: customerId, contract_number: cn, description: desc }),
                });
                renderAdminCustomerDetail(customerId);
            } catch (err) { showAlert(err.message); }
        }},
            h("div", { className: "form-card" },
                h("div", { className: "form-row" },
                    h("div", {},
                        h("label", {}, "Contract Number"),
                        h("input", { name: "contract_number", required: "true", placeholder: "SD-123-a", pattern: "[A-Za-z0-9-]+" }),
                    ),
                    h("div", {},
                        h("label", {}, "Description"),
                        h("input", { name: "description", placeholder: "Optional" }),
                    ),
                ),
                h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Add Contract"),
            ),
        );
        app.appendChild(form);

        app.appendChild(h("div", { className: "section-label" }, "Contracts"));

        if (!customer.contracts.length) {
            app.appendChild(h("p", { className: "empty" }, "No contracts yet."));
        }
        for (const c of customer.contracts) {
            app.appendChild(
                h("div", { className: "card card-clickable", onclick: () => renderAdminContractDetail(c.id, customerId) },
                    h("div", { className: "card-header" },
                        h("h3", {}, c.contract_number),
                    ),
                    c.description ? h("p", { className: "meta" }, c.description) : null,
                )
            );
        }
    } catch (e) { showAlert(e.message); }
}

// --- Admin views: Contract detail (manage users) ---

async function renderAdminContractDetail(contractId, customerId) {
    clear(app);
    try {
        const contract = await api(`/api/admin/contracts/${contractId}`);

        app.appendChild(breadcrumbs(
            { label: "Admin" },
            { label: "Customers", onclick: renderAdminCustomers },
            { label: contract.customer.name, onclick: () => renderAdminCustomerDetail(contract.customer.id) },
            { label: contract.contract_number },
        ));
        app.appendChild(h("h2", {}, contract.contract_number));
        app.appendChild(h("p", { className: "page-desc" },
            contract.customer.name + " (" + contract.customer.domain + ")" +
            (contract.description ? " — " + contract.description : ""),
        ));

        app.appendChild(h("div", { className: "section-label" }, "Grant Access"));

        const form = h("form", { onsubmit: async (e) => {
            e.preventDefault();
            const sub = form.querySelector('[name="user_sub"]').value.trim();
            try {
                await api(`/api/admin/contracts/${contractId}/users`, {
                    method: "POST",
                    body: JSON.stringify({ user_sub: sub }),
                });
                renderAdminContractDetail(contractId, customerId);
            } catch (err) { showAlert(err.message); }
        }},
            h("div", { className: "form-card" },
                h("div", { className: "form-row" },
                    h("div", {},
                        h("label", {}, "User (OIDC sub / email)"),
                        h("input", { name: "user_sub", required: "true", placeholder: "user@example.se" }),
                    ),
                    h("div", { style: "display:flex;align-items:flex-end;padding-bottom:12px" },
                        h("button", { type: "submit", className: "btn btn-primary btn-small" }, "Grant Access"),
                    ),
                ),
            ),
        );
        app.appendChild(form);

        app.appendChild(h("div", { className: "section-label" }, "Authorized Users"));

        if (!contract.users.length) {
            app.appendChild(h("p", { className: "empty" }, "No users have access yet."));
        } else {
            const ul = h("ul", { className: "user-list" });
            for (const userSub of contract.users) {
                ul.appendChild(h("li", {},
                    h("span", { className: "user-email" }, userSub),
                    h("button", {
                        className: "btn btn-danger",
                        onclick: async (e) => {
                            e.stopPropagation();
                            if (confirm(`Revoke access for ${userSub}?`)) {
                                await api(`/api/admin/contracts/${contractId}/users/${encodeURIComponent(userSub)}`, { method: "DELETE" });
                                renderAdminContractDetail(contractId, customerId);
                            }
                        },
                    }, "Revoke"),
                ));
            }
            app.appendChild(ul);
        }
    } catch (e) { showAlert(e.message); }
}

// --- Init ---

async function init() {
    try {
        currentUser = await api("/api/me");
        renderNav();
        renderContracts();
    } catch {
        renderLogin();
    }
}

init();
