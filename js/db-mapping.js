// camelCase (JS / mockData) ↔ snake_case (Postgres) 雙向轉換
// 被 migrate-to-supabase.js 跟 sync.js 共用

// === JS → DB ===
export const toDb = {
    building: b => ({
        id: b.id,
        name: b.name,
        base_address: b.baseAddress ?? null,
        group: b.group ?? null,
        status: b.status ?? 'active',
        note: b.note ?? null
    }),
    property: p => ({
        id: p.id,
        building_id: p.buildingId ?? null,
        name: p.name,
        address: p.address ?? null,
        status: p.status ?? null,
        rent: p.rent != null ? Number(p.rent) : null,
        tenant: p.tenant ?? null,
        contract_id: p.contractId ?? null,
        contract_end: p.contractEnd ?? null,
        room_number: p.roomNumber != null ? Number(p.roomNumber) : null,
        bed_letter: p.bedLetter ?? null,
        gender: p.gender ?? null,
        capacity: p.capacity != null ? Number(p.capacity) : null
    }),
    tenant: t => ({
        id: t.id,
        name: t.name,
        phone: t.phone ?? null,
        email: t.email ?? null,
        current_property: t.currentProperty ?? null,
        status: t.status ?? null,
        emergency_contact: t.emergencyContact ?? null,
        source: t.source ?? null,
        line_user_id: t.lineUserId ?? null,
        line_display_name: t.lineDisplayName ?? null,
        line_picture_url: t.linePictureUrl ?? null,
        line_bound_at: t.lineBoundAt ?? null,
        note: t.note ?? null,
        id_card_front_path: t.idCardFrontPath ?? null,
        id_card_back_path: t.idCardBackPath ?? null,
        id_card_uploaded_at: t.idCardUploadedAt ?? null
    }),
    contract: c => ({
        id: c.id,
        property_id: c.propertyId ?? null,
        property_name: c.propertyName ?? null,
        tenant: c.tenant ?? null,
        sign_date: c.signDate ?? null,
        start_date: c.startDate ?? null,
        end_date: c.endDate ?? null,
        term_months: c.termMonths ?? null,
        status: c.status ?? null,
        amount: c.amount ?? null,
        deposit_amount: c.depositAmount ?? 0,
        parent_contract_id: c.parentContractId ?? null,
        renewal_state: c.renewalState ?? 'active',
        snooze_until: c.snoozeUntil ?? null,
        signed_file_url: c.signedFileUrl ?? null,
        terminated_date: c.terminatedDate ?? null,
        decision_taken_at: c.decisionTakenAt ?? null,
        decision_note: c.decisionNote ?? null,
        // 續租意願 (LINE 自動詢問)
        renew_intent: c.renewIntent ?? null,
        renew_asked_at: c.renewAskedAt ?? null,
        renew_response_at: c.renewResponseAt ?? null,
        renew_note: c.renewNote ?? null
    }),
    invoice: i => ({
        id: i.id,
        contract_id: i.contractId ?? null,
        direction: i.direction,
        building_id: i.buildingId ?? null,
        property_name: i.propertyName ?? null,
        tenant: i.tenant ?? null,
        type: i.type,
        amount: i.amount,
        due_date: i.dueDate ?? null,
        status: i.status ?? null,
        paid_date: i.paidDate ?? null,
        period_start: i.periodStart ?? null,
        period_end: i.periodEnd ?? null,
        note: i.note ?? null,
        bank_last5: i.bankLast5 ?? null,
        bank_verified: i.bankVerified ?? false,
        discount: i.discount ?? 0,
        discount_reason: i.discountReason ?? null,
        paid_amount: i.paidAmount ?? 0,
        payment_method: i.paymentMethod ?? null
    }),
    maintenance: m => ({
        id: m.id,
        property_name: m.propertyName ?? null,
        issue: m.issue ?? null,
        reporter: m.reporter ?? null,
        report_date: m.reportDate ?? null,
        status: m.status ?? null,
        cost: m.cost ?? null
    }),
    checkin: c => ({
        id: c.id,
        tenant_name: c.tenantName ?? null,
        property_name: c.propertyName ?? null,
        scheduled_date: c.scheduledDate ?? null,
        status: c.status ?? null,
        tasks: c.tasks ?? null
    }),
    invoiceType: it => ({
        id: it.id,
        name: it.name,
        direction: it.direction,
        is_recurring: it.isRecurring ?? false,
        note: it.note ?? null
    }),
    tenantSource: s => ({
        id: s.id,
        name: s.name,
        note: s.note ?? null
    }),
    paymentMethod: p => ({
        id: p.id,
        name: p.name,
        note: p.note ?? null
    }),
    contractTemplate: ct => ({
        building_id: ct.buildingId,
        file_name: ct.fileName ?? null,
        pdf_base64: ct.pdfBase64 ?? null,
        uploaded_at: ct.uploadedAt ?? null
    }),
    // === 代管模式 ===
    owner: o => ({
        id: o.id,
        name: o.name,
        gender: o.gender ?? '',
        phone: o.phone ?? '',
        email: o.email ?? '',
        line_id: o.lineId ?? '',
        source: o.source ?? '員工面談',
        how_known: o.howKnown ?? '',
        how_known_other: o.howKnownOther ?? '',
        note: o.note ?? '',
        status: o.status ?? 'active',
        submitted_at: o.submittedAt ?? null,
        reviewed_by: o.reviewedBy ?? null,
        reviewed_at: o.reviewedAt ?? null
    }),
    deposit: d => ({
        id: d.id,
        contract_id: d.contractId ?? null,
        tenant_name: d.tenantName ?? '',
        property_name: d.propertyName ?? '',
        building_id: d.buildingId ?? null,
        amount: Number(d.amount) || 0,
        holder: d.holder ?? 'pms',
        collected_date: d.collectedDate ?? null,
        transferred_date: d.transferredDate ?? null,
        note: d.note ?? ''
    }),
    settlement: s => ({
        id: s.id,
        owner_id: s.ownerId ?? null,
        building_id: s.buildingId ?? null,
        month: s.month,
        items: s.items ?? [],
        owner_receivable: Number(s.ownerReceivable) || 0,
        deposit_collected_this_month: Number(s.depositCollectedThisMonth) || 0,
        deposit_transferred_this_month: Number(s.depositTransferredThisMonth) || 0,
        owner_holding_deposit_total: Number(s.ownerHoldingDepositTotal) || 0,
        status: s.status ?? 'draft',
        sent_at: s.sentAt ?? null
    })
};

// === DB → JS ===
export const fromDb = {
    building: r => ({
        id: r.id,
        name: r.name,
        baseAddress: r.base_address,
        group: r.group,
        status: r.status,
        note: r.note
    }),
    property: r => ({
        id: r.id,
        buildingId: r.building_id,
        name: r.name,
        address: r.address,
        status: r.status,
        rent: r.rent,
        tenant: r.tenant,
        contractId: r.contract_id,
        contractEnd: r.contract_end,
        roomNumber: r.room_number,
        bedLetter: r.bed_letter,
        gender: r.gender,
        capacity: r.capacity
    }),
    tenant: r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        currentProperty: r.current_property,
        status: r.status,
        emergencyContact: r.emergency_contact,
        source: r.source,
        lineUserId: r.line_user_id,
        lineDisplayName: r.line_display_name,
        linePictureUrl: r.line_picture_url,
        lineBoundAt: r.line_bound_at,
        note: r.note,
        idCardFrontPath: r.id_card_front_path,
        idCardBackPath: r.id_card_back_path,
        idCardUploadedAt: r.id_card_uploaded_at
    }),
    contract: r => ({
        id: r.id,
        propertyId: r.property_id,
        propertyName: r.property_name,
        tenant: r.tenant,
        signDate: r.sign_date,
        startDate: r.start_date,
        endDate: r.end_date,
        termMonths: r.term_months,
        status: r.status,
        amount: r.amount,
        depositAmount: r.deposit_amount,
        parentContractId: r.parent_contract_id,
        renewalState: r.renewal_state,
        snoozeUntil: r.snooze_until,
        signedFileUrl: r.signed_file_url,
        terminatedDate: r.terminated_date,
        decisionTakenAt: r.decision_taken_at,
        decisionNote: r.decision_note,
        renewIntent: r.renew_intent,
        renewAskedAt: r.renew_asked_at,
        renewResponseAt: r.renew_response_at,
        renewNote: r.renew_note
    }),
    invoice: r => ({
        id: r.id,
        contractId: r.contract_id,
        direction: r.direction,
        buildingId: r.building_id,
        propertyName: r.property_name,
        tenant: r.tenant,
        type: r.type,
        amount: r.amount,
        dueDate: r.due_date,
        status: r.status,
        paidDate: r.paid_date,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        note: r.note,
        bankLast5: r.bank_last5,
        bankVerified: r.bank_verified,
        discount: r.discount ?? 0,
        discountReason: r.discount_reason,
        paidAmount: r.paid_amount ?? 0,
        paymentMethod: r.payment_method
    }),
    maintenance: r => ({
        id: r.id,
        propertyName: r.property_name,
        issue: r.issue,
        reporter: r.reporter,
        reportDate: r.report_date,
        status: r.status,
        cost: r.cost
    }),
    checkin: r => ({
        id: r.id,
        tenantName: r.tenant_name,
        propertyName: r.property_name,
        scheduledDate: r.scheduled_date,
        status: r.status,
        tasks: r.tasks
    }),
    invoiceType: r => ({
        id: r.id,
        name: r.name,
        direction: r.direction,
        isRecurring: r.is_recurring,
        note: r.note
    }),
    tenantSource: r => ({
        id: r.id,
        name: r.name,
        note: r.note
    }),
    paymentMethod: r => ({
        id: r.id,
        name: r.name,
        note: r.note
    }),
    contractTemplate: r => ({
        buildingId: r.building_id,
        fileName: r.file_name,
        pdfBase64: r.pdf_base64,
        uploadedAt: r.uploaded_at
    }),
    // === 代管模式 (sql/20-managed-mode-schema-2026-06-17.sql) ===
    owner: r => ({
        id: r.id,
        name: r.name,
        gender: r.gender ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        lineId: r.line_id ?? '',
        source: r.source ?? '員工面談',
        howKnown: r.how_known ?? '',
        howKnownOther: r.how_known_other ?? '',
        note: r.note ?? '',
        status: r.status ?? 'active',
        submittedAt: r.submitted_at,
        reviewedBy: r.reviewed_by ?? null,
        reviewedAt: r.reviewed_at ?? null
    }),
    deposit: r => ({
        id: r.id,
        contractId: r.contract_id ?? null,
        tenantName: r.tenant_name ?? '',
        propertyName: r.property_name ?? '',
        buildingId: r.building_id ?? null,
        amount: Number(r.amount) || 0,
        holder: r.holder ?? 'pms',
        collectedDate: r.collected_date,
        transferredDate: r.transferred_date,
        note: r.note ?? ''
    }),
    settlement: r => ({
        id: r.id,
        ownerId: r.owner_id ?? null,
        buildingId: r.building_id ?? null,
        month: r.month,
        items: Array.isArray(r.items) ? r.items : (r.items ? r.items : []),
        ownerReceivable: Number(r.owner_receivable) || 0,
        depositCollectedThisMonth: Number(r.deposit_collected_this_month) || 0,
        depositTransferredThisMonth: Number(r.deposit_transferred_this_month) || 0,
        ownerHoldingDepositTotal: Number(r.owner_holding_deposit_total) || 0,
        status: r.status ?? 'draft',
        sentAt: r.sent_at,
        createdAt: r.created_at
    })
};

// === 表清單 (依 FK 依賴順序，buildings 在前；contract_templates 因有大欄位另外標記) ===
// src: mockData 的 key (camelCase) / table: Supabase table name (snake_case)
export const TABLES = [
    { key: 'buildings',          src: 'buildings',         pk: 'id',          toDb: toDb.building,         fromDb: fromDb.building,         large: false },
    { key: 'tenants',            src: 'tenants',           pk: 'id',          toDb: toDb.tenant,           fromDb: fromDb.tenant,           large: false },
    { key: 'properties',         src: 'properties',        pk: 'id',          toDb: toDb.property,         fromDb: fromDb.property,         large: false },
    { key: 'contracts',          src: 'contracts',         pk: 'id',          toDb: toDb.contract,         fromDb: fromDb.contract,         large: false },
    { key: 'invoices',           src: 'invoices',          pk: 'id',          toDb: toDb.invoice,          fromDb: fromDb.invoice,          large: false },
    { key: 'maintenances',       src: 'maintenances',      pk: 'id',          toDb: toDb.maintenance,      fromDb: fromDb.maintenance,      large: false },
    { key: 'checkins',           src: 'checkins',          pk: 'id',          toDb: toDb.checkin,          fromDb: fromDb.checkin,          large: false },
    { key: 'invoice_types',      src: 'invoiceTypes',      pk: 'id',          toDb: toDb.invoiceType,      fromDb: fromDb.invoiceType,      large: false },
    { key: 'tenant_sources',     src: 'tenantSources',     pk: 'id',          toDb: toDb.tenantSource,     fromDb: fromDb.tenantSource,     large: false },
    { key: 'payment_methods',    src: 'paymentMethods',    pk: 'id',          toDb: toDb.paymentMethod,    fromDb: fromDb.paymentMethod,    large: false },
    { key: 'contract_templates', src: 'contractTemplates', pk: 'building_id', toDb: toDb.contractTemplate, fromDb: fromDb.contractTemplate, large: true  },
    // === 代管模式 (sql/20-managed-mode-schema-2026-06-17.sql) ===
    { key: 'owners',             src: 'owners',            pk: 'id',          toDb: toDb.owner,            fromDb: fromDb.owner,            large: false },
    { key: 'deposits',           src: 'deposits',          pk: 'id',          toDb: toDb.deposit,          fromDb: fromDb.deposit,          large: false },
    { key: 'settlements',        src: 'settlements',       pk: 'id',          toDb: toDb.settlement,       fromDb: fromDb.settlement,       large: false }
];

export const SMALL_TABLES = TABLES.filter(t => !t.large);
export const LARGE_TABLES = TABLES.filter(t => t.large);
