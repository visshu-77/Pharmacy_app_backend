import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import leadModel from "../model/lead.js";
import leadStatusModel from "../model/leadStatus.js";
import leadActivityModel from "../model/leadActivity.js";
import leadFollowUpModel from "../model/leadFollowUp.js";
import leadConversionModel from "../model/leadConversion.js";
import leadNotificationModel from "../model/leadNotification.js";
import leadSettingsModel from "../model/leadSettings.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import { connectTestDb, createShop, disconnectTestDb, startApi } from "./helpers.mjs";

let api;
let shop;
let otherShop;
let statuses;

const leadPayload = (statusId, extra = {}) => ({
    customerName: "  Asha Patel ",
    mobileNumber: "9876543210",
    email: "asha@example.com",
    title: "Product inquiry",
    source: "Website",
    priority: "High",
    statusId,
    leadDate: "2026-11-17",
    ...extra
});

const asShop = (token) => ({
    get: (path) => api.request("GET", path, { token }),
    post: (path, body) => api.request("POST", path, { token, body }),
    patch: (path, body) => api.request("PATCH", path, { token, body }),
    delete: (path) => api.request("DELETE", path, { token })
});

before(async () => {
    await connectTestDb("storeflow_test_leads_api");
    await Promise.all([
        leadModel.syncIndexes(),
        leadStatusModel.syncIndexes(),
        leadActivityModel.syncIndexes(),
        leadFollowUpModel.syncIndexes(),
        leadConversionModel.syncIndexes(),
        leadNotificationModel.syncIndexes(),
        leadSettingsModel.syncIndexes(),
        expenseTransactionModel.syncIndexes()
    ]);
    api = await startApi();
    shop = await createShop();
    otherShop = await createShop();
    const result = await asShop(shop.token).get("/leads/statuses");
    statuses = result.body.statuses;
});

after(async () => {
    api?.close();
    await disconnectTestDb();
});

beforeEach(async () => {
    await Promise.all([
        leadModel.deleteMany({}),
        leadActivityModel.deleteMany({}),
        leadStatusModel.deleteMany({}),
        leadFollowUpModel.deleteMany({}),
        leadConversionModel.deleteMany({}),
        leadNotificationModel.deleteMany({}),
        leadSettingsModel.deleteMany({}),
        expenseTransactionModel.deleteMany({})
    ]);
    const result = await asShop(shop.token).get("/leads/statuses");
    statuses = result.body.statuses;
});

test("lead APIs require authentication and subscription", async () => {
    const unauthenticated = await api.request("GET", "/leads");
    assert.equal(unauthenticated.status, 401);

    const noPlan = await createShop({ withSubscription: false });
    const blocked = await asShop(noPlan.token).get("/leads/dashboard");
    assert.equal(blocked.status, 403);
});

test("creates leads in the authenticated tenant and records status history", async () => {
    const created = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id));
    assert.equal(created.status, 201);
    assert.equal(created.body.lead.customerName, "Asha Patel");
    assert.equal(String(created.body.lead.userId), shop.userId);

    const saved = await leadModel.findById(created.body.lead._id);
    assert.equal(String(saved.userId), shop.userId);
    assert.equal(await leadActivityModel.countDocuments({ leadId: saved._id, type: "created" }), 1);

    const contacted = statuses.find((status) => status.name === "Contacted");
    const changed = await asShop(shop.token).patch(`/leads/${saved._id}/status`, { statusId: contacted._id });
    assert.equal(changed.status, 200);
    const detail = await asShop(shop.token).get(`/leads/${saved._id}`);
    const statusActivity = detail.body.activities.find((activity) => activity.type === "status_changed");
    assert.equal(statusActivity.previousStatus, "New Lead");
    assert.equal(statusActivity.newStatus, "Contacted");
    assert.equal(statusActivity.changedBy, shop.user.email);
});

test("validates lead fields and prevents cross-tenant access", async () => {
    const invalid = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id, {
        email: "not-an-email"
    }));
    assert.equal(invalid.status, 400);

    const created = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id));
    const otherOwner = asShop(otherShop.token);
    assert.equal((await otherOwner.get(`/leads/${created.body.lead._id}`)).status, 404);
    assert.equal((await otherOwner.get("/leads")).body.total, 0);
});

test("filters and paginates leads, bulk updates them, and exports CSV", async () => {
    const status = statuses.find((item) => item.name === "New Lead");
    const first = await asShop(shop.token).post("/leads", leadPayload(status._id, { customerName: "Asha Patel", source: "Website" }));
    await asShop(shop.token).post("/leads", leadPayload(status._id, { customerName: "Ravi Shah", source: "Referral" }));

    const filtered = await asShop(shop.token).get(`/leads?search=Asha&source=Website&page=1&limit=1`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.leads[0].customerName, "Asha Patel");

    const contacted = statuses.find((item) => item.name === "Contacted");
    const bulk = await asShop(shop.token).patch("/leads/bulk", {
        ids: [first.body.lead._id],
        statusId: contacted._id,
        assignedEmployee: "Meera"
    });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.body.updated, 1);
    const saved = await leadModel.findById(first.body.lead._id);
    assert.equal(saved.statusName, "Contacted");
    assert.equal(saved.assignedEmployee, "Meera");
    assert.equal(await leadActivityModel.countDocuments({ leadId: saved._id, type: "status_changed" }), 1);

    const csv = await api.requestRaw("GET", "/leads/export?source=Website", { token: shop.token });
    assert.equal(csv.status, 200);
    assert.match(csv.headers["content-type"], /text\/csv/);
    assert.match(csv.text, /Asha Patel/);
    assert.doesNotMatch(csv.text, /Ravi Shah/);
});

test("status edits preserve status-change history and custom statuses are tenant scoped", async () => {
    const custom = await asShop(shop.token).post("/leads/statuses", {
        name: "Needs Review", color: "#cc00aa", order: 20
    });
    assert.equal(custom.status, 201);
    assert.equal((await asShop(otherShop.token).get("/leads/statuses")).body.statuses.some((status) => status.name === "Needs Review"), false);

    const created = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id));
    const update = await asShop(shop.token).patch(`/leads/${created.body.lead._id}`, leadPayload(custom.body.status._id));
    assert.equal(update.status, 200);
    const detail = await asShop(shop.token).get(`/leads/${created.body.lead._id}`);
    assert.ok(detail.body.activities.some((activity) =>
        activity.type === "status_changed" && activity.previousStatus === "New Lead" && activity.newStatus === "Needs Review"
    ));

    const deactivate = await asShop(shop.token).patch(`/leads/statuses/${custom.body.status._id}`, { active: false });
    assert.equal(deactivate.status, 200);
    const historyAfterDeactivate = await asShop(shop.token).get(`/leads/${created.body.lead._id}`);
    assert.ok(historyAfterDeactivate.body.activities.some((activity) => activity.newStatus === "Needs Review"));
});

test("follow-ups can be scheduled, rescheduled, completed, and kept tenant scoped", async () => {
    const created = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id, {
        assignedEmployee: "Meera"
    }));
    const futureDate = (days) => new Date(Date.now() + days * 86400000).toISOString();
    const scheduled = await asShop(shop.token).post("/leads/followups", {
        leadId: created.body.lead._id,
        type: "Phone Call",
        scheduledAt: futureDate(3),
        reminderMinutes: 60,
        description: "Discuss requirements"
    });
    assert.equal(scheduled.status, 201);
    assert.equal(scheduled.body.followUp.assignedEmployee, "Meera");

    const rescheduled = await asShop(shop.token).patch(
        `/leads/followups/${scheduled.body.followUp._id}`,
        { status: "Rescheduled", scheduledAt: futureDate(4) }
    );
    assert.equal(rescheduled.status, 200);
    assert.equal(rescheduled.body.followUp.status, "Rescheduled");
    assert.equal((await leadFollowUpModel.findById(rescheduled.body.replacement._id)).status, "Pending");

    const upcoming = await asShop(shop.token).get("/leads/followups?view=upcoming");
    assert.equal(upcoming.body.total, 1);
    assert.equal(String(upcoming.body.followUps[0].leadId._id), created.body.lead._id);
    assert.equal((await asShop(otherShop.token).get("/leads/followups?view=upcoming")).body.total, 0);

    const completed = await asShop(shop.token).patch(
        `/leads/followups/${rescheduled.body.replacement._id}`,
        { status: "Completed" }
    );
    assert.equal(completed.status, 200);
    assert.equal(completed.body.followUp.status, "Completed");
    assert.equal((await asShop(shop.token).get("/leads/followups?view=completed")).body.total, 1);

    const activity = await asShop(shop.token).post(`/leads/${created.body.lead._id}/activities`, {
        type: "call_made",
        description: "Spoke with the customer"
    });
    assert.equal(activity.status, 201);
    const detail = await asShop(shop.token).get(`/leads/${created.body.lead._id}`);
    assert.ok(detail.body.activities.some((item) => item.type === "followup_scheduled"));
    assert.ok(detail.body.activities.some((item) => item.type === "call_made"));
});

test("migrates a Phase 1 next-follow-up date only once", async () => {
    const created = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id, {
        nextFollowUpAt: new Date(Date.now() + 2 * 86400000).toISOString()
    }));
    const originalDate = new Date(created.body.lead.nextFollowUpAt).getTime();

    await asShop(shop.token).get("/leads/dashboard");
    await asShop(shop.token).get("/leads/followups?view=upcoming");
    assert.equal(await leadFollowUpModel.countDocuments({
        leadId: created.body.lead._id, legacyImport: true
    }), 1);
    const migrated = await leadFollowUpModel.findOne({
        leadId: created.body.lead._id, legacyImport: true
    });
    assert.equal(migrated.scheduledAt.getTime(), originalDate);
    assert.equal((await leadModel.findById(created.body.lead._id)).legacyFollowUpImported, true);
});

test("pipeline and team summaries reflect assignments and expected deal values", async () => {
    const created = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id, {
        assignedEmployee: "Meera",
        expectedDealValue: 12500
    }));
    const pipeline = await asShop(shop.token).get("/leads/pipeline");
    const newStage = pipeline.body.stages.find((stage) => stage.systemKey === "new_lead");
    assert.equal(newStage.count, 1);
    assert.equal(newStage.expectedDealValue, 12500);
    assert.equal(String(newStage.leads[0]._id), created.body.lead._id);

    const team = await asShop(shop.token).get("/leads/team");
    const employee = team.body.employees.find((item) => item.employee === "Meera");
    assert.equal(employee.total, 1);
    assert.equal(employee.pending, 1);
    assert.equal(employee.expectedDealValue, 12500);
});

test("conversion is unique and lost outcomes require a valid reason", async () => {
    const first = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id, {
        assignedEmployee: "Meera"
    }));
    const conversion = await asShop(shop.token).post(`/leads/${first.body.lead._id}/convert`, {
        finalDealAmount: 12345.67,
        conversionDate: "2026-11-17",
        notes: "Order confirmed",
        responsibleEmployee: "Meera"
    });
    assert.equal(conversion.status, 201);
    assert.match(conversion.body.conversion.referenceId, /^CNV-/);
    assert.equal(await leadConversionModel.countDocuments({ leadId: first.body.lead._id }), 1);
    assert.equal((await asShop(shop.token).post(`/leads/${first.body.lead._id}/convert`, {
        finalDealAmount: 12345.67,
        conversionDate: "2026-11-17",
        responsibleEmployee: "Meera"
    })).status, 409);
    assert.equal((await asShop(shop.token).patch("/leads/bulk", {
        ids: [first.body.lead._id],
        statusId: statuses.find((item) => item.name === "Contacted")._id
    })).status, 409);
    assert.equal((await asShop(shop.token).delete(`/leads/${first.body.lead._id}`)).status, 409);
    assert.ok((await asShop(shop.token).get("/leads/notifications")).body.notifications
        .some((item) => item.kind === "lead_converted"));

    const second = await asShop(shop.token).post("/leads", leadPayload(statuses[0]._id));
    assert.equal((await asShop(shop.token).post(`/leads/${second.body.lead._id}/lost`, {
        reason: "made-up reason",
        remarks: "Not available"
    })).status, 400);
    const lost = await asShop(shop.token).post(`/leads/${second.body.lead._id}/lost`, {
        reason: "Budget Issue",
        remarks: "Budget was not approved"
    });
    assert.equal(lost.status, 200);
    assert.equal(lost.body.lead.lostReason, "Budget Issue");
    assert.equal((await asShop(shop.token).delete(`/leads/${second.body.lead._id}`)).status, 409);
});

test("CRM settings are tenant-scoped and custom source/category values filter correctly", async () => {
    const owner = asShop(shop.token);
    const savedSources = await owner.patch("/leads/settings/sources", { values: ["Trade Fair"] });
    assert.equal(savedSources.status, 200);
    await owner.patch("/leads/settings/categories", { values: ["Wholesale"] });

    const created = await owner.post("/leads", leadPayload(statuses[0]._id, {
        source: "Trade Fair",
        category: "Wholesale"
    }));
    assert.equal(created.status, 201);
    assert.equal((await owner.get("/leads?source=Trade%20Fair&category=Wholesale")).body.total, 1);
    const historicalSourceFilter = await owner.get("/leads?source=Website");
    assert.equal(historicalSourceFilter.status, 200);
    assert.equal(historicalSourceFilter.body.total, 0);

    const otherSettings = await asShop(otherShop.token).get("/leads/settings");
    assert.ok(otherSettings.body.settings.sources.includes("Website"));
    assert.ok(!otherSettings.body.settings.sources.includes("Trade Fair"));
});

test("Completed status is always seeded and remains selectable", async () => {
    const owner = asShop(shop.token);
    const completedStatus = statuses.find((status) =>
        status.systemKey === "completed" || status.name.toLowerCase() === "completed"
    );
    assert.ok(completedStatus);

    await leadStatusModel.updateOne(
        { _id: completedStatus._id },
        { $set: { active: false, systemKey: null } }
    );
    const refreshed = await owner.get("/leads/statuses");
    const completed = refreshed.body.statuses.find((status) =>
        status.systemKey === "completed" || status.name.toLowerCase() === "completed"
    );
    assert.equal(completed.active, true);
    assert.equal(completed.systemKey, "completed");
    assert.equal((await owner.patch(`/leads/statuses/${completed._id}`, { active: false })).status, 400);
});

test("completing a lead requires both amounts without creating a conversion", async () => {
    const owner = asShop(shop.token);
    const completedStatus = statuses.find((status) => status.systemKey === "completed" || status.name === "Completed");
    assert.ok(completedStatus);
    const created = await owner.post("/leads", leadPayload(statuses[0]._id));
    const missingAmounts = await owner.patch(`/leads/${created.body.lead._id}/status`, {
        statusId: completedStatus._id
    });
    assert.equal(missingAmounts.status, 400);

    const completed = await owner.patch(`/leads/${created.body.lead._id}/status`, {
        statusId: completedStatus._id,
        finalQuotationAmount: 5000.25,
        finalAmount: 4500.5
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.lead.finalQuotationAmount, 5000.25);
    assert.equal(completed.body.lead.finalAmount, 4500.5);
    assert.equal(await leadConversionModel.countDocuments({ leadId: created.body.lead._id }), 0);

    const report = await owner.get("/leads/reports?from=2026-11-17&to=2026-11-17");
    assert.equal(report.body.summary.completedLeads, 1);
    assert.equal(report.body.summary.convertedLeads, 0);
    assert.equal(report.body.summary.convertedDealValue, 0);
    assert.equal(report.body.summary.expectedPipelineRevenue, 0);
});

test("duplicate merge archives the source, retains its history, and moves follow-ups", async () => {
    const owner = asShop(shop.token);
    const source = await owner.post("/leads", leadPayload(statuses[0]._id, {
        customerName: "Source Lead",
        notes: "Original context"
    }));
    const target = await owner.post("/leads", leadPayload(statuses[0]._id, {
        customerName: "Target Lead",
        mobileNumber: "9876543210"
    }));
    const activity = await owner.post(`/leads/${source.body.lead._id}/activities`, {
        type: "call_made",
        description: "Source call notes"
    });
    assert.equal(activity.status, 201);
    const followUp = await owner.post("/leads/followups", {
        leadId: source.body.lead._id,
        type: "Phone Call",
        scheduledAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        reminderMinutes: 0,
        description: "Follow up from the source record"
    });
    assert.equal(followUp.status, 201);

    const merged = await owner.post(`/leads/${source.body.lead._id}/merge`, {
        targetLeadId: target.body.lead._id
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.archivedLead.isMerged, true);
    assert.equal((await owner.get("/leads")).body.total, 1);
    const newStage = (await owner.get("/leads/pipeline")).body.stages.find((stage) => stage.systemKey === "new_lead");
    assert.equal(newStage.leads.length, 1);
    assert.equal(String(newStage.leads[0]._id), target.body.lead._id);
    assert.equal((await owner.post(`/leads/${source.body.lead._id}/activities`, {
        type: "call_made", description: "Archived record should be read-only"
    })).status, 404);
    assert.equal(await leadFollowUpModel.countDocuments({
        leadId: target.body.lead._id, description: "Follow up from the source record"
    }), 1);
    const details = await owner.get(`/leads/${target.body.lead._id}`);
    assert.ok(details.body.activities.some((item) => item.description === "Source call notes"));
    assert.ok(details.body.mergedSources.some((item) => String(item._id) === source.body.lead._id));
    assert.match(details.body.lead.notes, /Original context/);
});

test("confirmed conversion payments are idempotent and report income separately", async () => {
    const owner = asShop(shop.token);
    const date = new Date();
    const dateOnly = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
    const lead = await owner.post("/leads", leadPayload(statuses[0]._id, { leadDate: dateOnly }));
    const converted = await owner.post(`/leads/${lead.body.lead._id}/convert`, {
        finalDealAmount: 2000,
        conversionDate: date.toISOString(),
        responsibleEmployee: "Meera"
    });
    assert.equal(converted.status, 201);

    const payment = {
        amount: 500,
        transactionDate: date.toISOString(),
        paymentMethod: "UPI",
        eventKey: "phase3-payment-key-001"
    };
    assert.equal((await owner.post(`/leads/${lead.body.lead._id}/record-income`, payment)).status, 201);
    const duplicate = await owner.post(`/leads/${lead.body.lead._id}/record-income`, payment);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicateSubmission, true);
    assert.equal(await expenseTransactionModel.countDocuments({
        sourceConversionId: converted.body.conversion._id
    }), 1);

    await expenseTransactionModel.create({
        userId: shop.userId,
        title: "Independent income",
        type: "income",
        amount: 1000,
        paymentMethod: "Cash",
        transactionDate: date,
        description: "Not related to a CRM conversion"
    });
    const report = await owner.get(`/leads/reports?from=${dateOnly}&to=${dateOnly}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.summary.confirmedIncome, 1500);
    assert.equal(report.body.summary.crmConfirmedIncome, 500);
    assert.equal(report.body.summary.convertedDealValue, 2000);
});
