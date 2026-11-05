import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application error carrying a stable machine-readable code and a bilingual
 * human message. The global filter renders the standard envelope.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly messageAr: string;
  readonly details: unknown;

  constructor(
    code: string,
    message: string,
    messageAr: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details: unknown = null,
  ) {
    super(message, status);
    this.code = code;
    this.messageAr = messageAr;
    this.details = details;
  }
}

/** Common errors (codes are stable API surface). */
export const Errors = {
  invalidCredentials: () =>
    new AppException('INVALID_CREDENTIALS', 'Invalid email or password.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', HttpStatus.UNAUTHORIZED),
  accountInactive: () =>
    new AppException('ACCOUNT_INACTIVE', 'This account is deactivated.', 'هذا الحساب معطّل.', HttpStatus.FORBIDDEN),
  accountLocked: (until: Date) =>
    new AppException('ACCOUNT_LOCKED', 'Account locked after too many failed attempts.', 'تم قفل الحساب بعد محاولات فاشلة كثيرة.', HttpStatus.LOCKED, { lockedUntil: until }),
  mfaRequired: () =>
    new AppException('MFA_REQUIRED', 'A one-time code is required.', 'رمز التحقق مطلوب.', HttpStatus.UNAUTHORIZED),
  invalidTotp: () =>
    new AppException('INVALID_TOTP', 'Invalid one-time code.', 'رمز التحقق غير صحيح.', HttpStatus.UNAUTHORIZED),
  firstRunDone: () =>
    new AppException('FIRST_RUN_DONE', 'Initial setup was already completed.', 'تم الإعداد الأولي مسبقًا.', HttpStatus.FORBIDDEN),
  forbidden: () =>
    new AppException('FORBIDDEN', 'You do not have permission to perform this action.', 'ليست لديك صلاحية لتنفيذ هذا الإجراء.', HttpStatus.FORBIDDEN),
  notMember: () =>
    new AppException('NOT_ORGANIZATION_MEMBER', 'You are not a member of this organization.', 'أنت لست عضوًا في هذه المنظمة.', HttpStatus.FORBIDDEN),
  orgHeaderMissing: () =>
    new AppException('ORGANIZATION_HEADER_MISSING', 'X-Organization-Id header is required.', 'ترويسة X-Organization-Id مطلوبة.', HttpStatus.BAD_REQUEST),
  notFound: (entity: string) =>
    new AppException('NOT_FOUND', `${entity} not found.`, 'غير موجود.', HttpStatus.NOT_FOUND, { entity }),
  invalidToken: () =>
    new AppException('INVALID_TOKEN', 'The token is invalid or expired.', 'الرمز غير صالح أو منتهي.', HttpStatus.BAD_REQUEST),
  systemRoleImmutable: () =>
    new AppException('SYSTEM_ROLE_IMMUTABLE', 'System roles cannot be modified.', 'لا يمكن تعديل أدوار النظام.', HttpStatus.FORBIDDEN),
  csrfInvalid: () =>
    new AppException('CSRF_INVALID', 'Invalid CSRF token.', 'رمز CSRF غير صالح.', HttpStatus.FORBIDDEN),
  duplicate: (field: string) =>
    new AppException('DUPLICATE', `A record with this ${field} already exists.`, 'يوجد سجل بهذه القيمة مسبقًا.', HttpStatus.CONFLICT, { field }),

  // ---------- Phase 3: accounting ----------
  unbalancedJournal: (totalDebit: string, totalCredit: string) =>
    new AppException('UNBALANCED_JOURNAL', 'Debits do not equal credits in functional currency.', 'مجموع المدين لا يساوي مجموع الدائن بالعملة الأساسية.', HttpStatus.UNPROCESSABLE_ENTITY, { total_debit: totalDebit, total_credit: totalCredit }),
  journalTooFewLines: () =>
    new AppException('JOURNAL_TOO_FEW_LINES', 'A journal must have at least two lines.', 'يجب أن يحتوي القيد على سطرين على الأقل.', HttpStatus.UNPROCESSABLE_ENTITY),
  accountNotPostable: (code: string) =>
    new AppException('ACCOUNT_NOT_POSTABLE', `Account ${code} is a summary account and cannot receive postings.`, `الحساب ${code} حساب إجمالي ولا يقبل قيودًا مباشرة.`, HttpStatus.UNPROCESSABLE_ENTITY, { code }),
  glAccountInactive: (code: string) =>
    new AppException('ACCOUNT_INACTIVE', `Account ${code} is deactivated.`, `الحساب ${code} معطّل.`, HttpStatus.UNPROCESSABLE_ENTITY, { code }),
  accountCompanyMismatch: () =>
    new AppException('ACCOUNT_COMPANY_MISMATCH', 'All lines must reference accounts of the same company.', 'يجب أن تشير كل السطور إلى حسابات نفس الشركة.', HttpStatus.UNPROCESSABLE_ENTITY),
  accountHasPostings: () =>
    new AppException('ACCOUNT_HAS_POSTINGS', 'This account has journal lines and cannot be deactivated or made non-postable.', 'هذا الحساب مرتبط بقيود ولا يمكن تعطيله أو تحويله لحساب إجمالي.', HttpStatus.CONFLICT),
  /** Same code, 422 — used when flipping is_postable true→false on PATCH. */
  accountHasPostingsUnprocessable: () =>
    new AppException('ACCOUNT_HAS_POSTINGS', 'This account has journal lines and cannot be made non-postable.', 'هذا الحساب مرتبط بقيود ولا يمكن تحويله إلى حساب إجمالي.', HttpStatus.UNPROCESSABLE_ENTITY),
  periodClosed: (name: string) =>
    new AppException('PERIOD_CLOSED', `Accounting period ${name} is closed or locked.`, `الفترة المحاسبية ${name} مغلقة أو مقفلة.`, 423, { period: name }),
  periodNotDefined: (date: string) =>
    new AppException('PERIOD_NOT_DEFINED', `No accounting period is defined for ${date}.`, `لا توجد فترة محاسبية معرفة لتاريخ ${date}.`, HttpStatus.UNPROCESSABLE_ENTITY, { date }),
  periodInvalidTransition: (from: string, to: string) =>
    new AppException('PERIOD_INVALID_TRANSITION', `Cannot transition period from ${from} to ${to}.`, `لا يمكن نقل الفترة من ${from} إلى ${to}.`, HttpStatus.UNPROCESSABLE_ENTITY, { from, to }),
  journalNotDraft: () =>
    new AppException('JOURNAL_NOT_DRAFT', 'Only draft journals can be modified.', 'يمكن تعديل القيود ذات حالة المسودة فقط.', HttpStatus.CONFLICT),
  journalNotPostable: () =>
    new AppException('JOURNAL_NOT_POSTABLE', 'Only submitted or approved journals can be posted.', 'يمكن ترحيل القيود المقدمة أو المعتمدة فقط.', HttpStatus.UNPROCESSABLE_ENTITY),
  journalInvalidTransition: (from: string, to: string) =>
    new AppException('JOURNAL_INVALID_TRANSITION', `Cannot transition journal from ${from} to ${to}.`, `لا يمكن نقل القيد من ${from} إلى ${to}.`, HttpStatus.UNPROCESSABLE_ENTITY, { from, to }),
  concurrentModification: () =>
    new AppException('CONCURRENT_MODIFICATION', 'The journal was modified by another request. Reload and retry.', 'تم تعديل القيد بواسطة طلب آخر. أعد التحميل وحاول مجددًا.', HttpStatus.CONFLICT),
  makerCheckerViolation: () =>
    new AppException('MAKER_CHECKER_VIOLATION', 'The creator of a journal cannot approve it (maker-checker control).', 'لا يمكن لمنشئ القيد اعتماده (قاعدة الفصل بين المنشئ والمعتمد).', HttpStatus.FORBIDDEN),
  coaNotSeeded: () =>
    new AppException('COA_NOT_SEEDED', 'The chart of accounts is not seeded for this company yet.', 'دليل الحسابات غير مُعدّ لهذه الشركة بعد.', HttpStatus.UNPROCESSABLE_ENTITY),

  // ---------- Phase 4: master data ----------
  duplicateSku: (sku: string) =>
    new AppException('DUPLICATE_SKU', `A product with SKU ${sku} already exists in this company.`, `يوجد منتج بنفس رمز SKU (${sku}) في هذه الشركة مسبقًا.`, HttpStatus.CONFLICT, { sku }),
  csvImportValidation: (rowErrors: Array<{ row: number; field: string; message: string; message_ar?: string }>) =>
    new AppException('CSV_IMPORT_VALIDATION', 'The CSV file has invalid rows. Nothing was imported.', 'ملف CSV يحتوي على صفوف غير صالحة. لم يتم استيراد أي شيء.', HttpStatus.UNPROCESSABLE_ENTITY, { rows: rowErrors }),
  attachmentTooLarge: (maxMb: number) =>
    new AppException('ATTACHMENT_TOO_LARGE', `The file exceeds the maximum size of ${maxMb} MB.`, `حجم الملف يتجاوز الحد الأقصى ${maxMb} ميجابايت.`, 413, { max_mb: maxMb }),
  invalidFileType: (mime: string) =>
    new AppException('INVALID_FILE_TYPE', `File type ${mime} is not allowed.`, `نوع الملف ${mime} غير مسموح به.`, HttpStatus.UNPROCESSABLE_ENTITY, { mime }),
  fileRequired: () =>
    new AppException('FILE_REQUIRED', 'A file must be attached to the request.', 'يجب إرفاق ملف بالطلب.', HttpStatus.BAD_REQUEST),
  productAccountInvalid: (detail: string, detailAr: string) =>
    new AppException('PRODUCT_ACCOUNT_INVALID', detail, detailAr, HttpStatus.UNPROCESSABLE_ENTITY),
  categoryParentCycle: () =>
    new AppException('CATEGORY_PARENT_CYCLE', 'This parent would create a cycle in the category hierarchy.', 'هذا الأب سيخلق دورة في شجرة الفئات.', HttpStatus.UNPROCESSABLE_ENTITY),
  ownerNotFound: (ownerType: string) =>
    new AppException('NOT_FOUND', `${ownerType} not found.`, 'غير موجود.', HttpStatus.NOT_FOUND, { entity: ownerType }),

  // ---------- Phase 5: inventory ----------
  insufficientStock: (productSku: string, available: string, requested: string) =>
    new AppException('INSUFFICIENT_STOCK', `Insufficient available stock for ${productSku}: available ${available}, requested ${requested}.`, `المخزون المتاح غير كافٍ للصنف ${productSku}: المتاح ${available}، المطلوب ${requested}.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku: productSku, available, requested }),
  productNotStocked: (sku: string) =>
    new AppException('PRODUCT_NOT_STOCKED', `Product ${sku} is not a stocked item and cannot have stock movements.`, `الصنف ${sku} ليس صنفًا مخزنيًا ولا يمكن أن تكون له حركات مخزون.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku }),
  invalidInventoryTransition: (from: string, to: string) =>
    new AppException('INVALID_INVENTORY_TRANSITION', `Cannot transition inventory document from ${from} to ${to}.`, `لا يمكن نقل مستند المخزون من ${from} إلى ${to}.`, HttpStatus.UNPROCESSABLE_ENTITY, { from, to }),
  sameWarehouseTransfer: () =>
    new AppException('SAME_WAREHOUSE_TRANSFER', 'Source and destination warehouses must be different.', 'يجب أن يكون مخزن المصدر والوجهة مختلفين.', HttpStatus.UNPROCESSABLE_ENTITY),
  openingStockExists: (sku: string) =>
    new AppException('OPENING_STOCK_EXISTS', `Product ${sku} already has stock movements; opening stock is only allowed on a clean product.`, `الصنف ${sku} لديه حركات مخزون بالفعل؛ رصيد الافتتاح مسموح فقط لصنف بلا حركات.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku }),
  adjustmentApprovalRequired: (impact: string) =>
    new AppException('ADJUSTMENT_APPROVAL_REQUIRED', `This adjustment's cost impact (${impact}) exceeds the auto-approval threshold and must be approved.`, `الأثر المالي لهذه التسوية (${impact}) يتجاوز حد الاعتماد التلقائي ويجب اعتمادها.`, HttpStatus.FORBIDDEN, { impact }),
  selfApprovalForbidden: () =>
    new AppException('SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own document.', 'لا يمكنك اعتماد مستندك بنفسك.', HttpStatus.FORBIDDEN),
  countLineMissing: (sku: string) =>
    new AppException('COUNT_LINE_MISSING', `Count line for ${sku} is missing a counted quantity.`, `سطر الجرد للصنف ${sku} يفتقد الكمية المحصاة.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku }),

  // ---------- Phase 6: sales ----------
  invalidSalesTransition: (doc: string, from: string, to: string) =>
    new AppException('INVALID_SALES_TRANSITION', `Cannot transition ${doc} from ${from} to ${to}.`, `لا يمكن نقل ${doc} من ${from} إلى ${to}.`, HttpStatus.UNPROCESSABLE_ENTITY, { doc, from, to }),
  salesDocNotDraft: (doc: string) =>
    new AppException('SALES_DOC_NOT_DRAFT', `Only draft ${doc} documents can be modified.`, `يمكن تعديل ${doc} في حالة المسودة فقط.`, HttpStatus.CONFLICT, { doc }),
  quotationExpired: (number: string) =>
    new AppException('QUOTATION_EXPIRED', `Quotation ${number} has expired and cannot be accepted.`, `عرض السعر ${number} انتهت صلاحيته ولا يمكن قبوله.`, HttpStatus.UNPROCESSABLE_ENTITY, { number }),
  quotationNotAccepted: (number: string) =>
    new AppException('QUOTATION_NOT_ACCEPTED', `Only an accepted quotation can be converted; ${number} is not accepted.`, `يمكن تحويل عرض السعر المقبول فقط؛ ${number} غير مقبول.`, HttpStatus.UNPROCESSABLE_ENTITY, { number }),
  overDelivery: (sku: string, remaining: string, requested: string) =>
    new AppException('OVER_DELIVERY', `Cannot deliver ${requested} of ${sku}: only ${remaining} remains undelivered on the order.`, `لا يمكن تسليم ${requested} من ${sku}: المتبقي غير المسلّم على الطلب هو ${remaining} فقط.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku, remaining, requested }),
  overInvoice: (doc: string, remaining: string, requested: string) =>
    new AppException('OVER_INVOICE', `Cannot invoice ${requested} on ${doc}: only ${remaining} remains uninvoiced.`, `لا يمكن فوترة ${requested} على ${doc}: المتبقي غير المفوتر هو ${remaining} فقط.`, HttpStatus.UNPROCESSABLE_ENTITY, { doc, remaining, requested }),
  invoiceNotPosted: (number: string) =>
    new AppException('INVOICE_NOT_POSTED', `Invoice ${number} is not posted; payments can only apply to posted invoices.`, `الفاتورة ${number} غير مرحّلة؛ لا يمكن تطبيق المدفوعات إلا على الفواتير المرحّلة.`, HttpStatus.UNPROCESSABLE_ENTITY, { number }),
  overAllocation: (number: string, outstanding: string, requested: string) =>
    new AppException('OVER_ALLOCATION', `Cannot allocate ${requested} to invoice ${number}: outstanding is ${outstanding}.`, `لا يمكن تخصيص ${requested} للفاتورة ${number}: المتبقي ${outstanding}.`, HttpStatus.UNPROCESSABLE_ENTITY, { number, outstanding, requested }),
  creditExceedsReceivable: (number: string, outstanding: string, requested: string) =>
    new AppException('CREDIT_EXCEEDS_RECEIVABLE', `Credit note of ${requested} exceeds the outstanding ${outstanding} on invoice ${number}.`, `إشعار الدائن ${requested} يتجاوز المتبقي ${outstanding} على الفاتورة ${number}.`, HttpStatus.UNPROCESSABLE_ENTITY, { number, outstanding, requested }),
  serviceProductNoDelivery: (sku: string) =>
    new AppException('SERVICE_PRODUCT_NO_DELIVERY', `Product ${sku} is a service and cannot be delivered from stock.`, `الصنف ${sku} خدمة ولا يمكن تسليمه من المخزون.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku }),

  // ---------- Phase 7: purchasing ----------
  invalidPurchasingTransition: (doc: string, from: string, to: string) =>
    new AppException('INVALID_PURCHASING_TRANSITION', `Cannot transition ${doc} from ${from} to ${to}.`, `لا يمكن نقل ${doc} من ${from} إلى ${to}.`, HttpStatus.UNPROCESSABLE_ENTITY, { doc, from, to }),
  purchasingDocNotDraft: (doc: string) =>
    new AppException('PURCHASING_DOC_NOT_DRAFT', `Only draft ${doc} documents can be modified.`, `يمكن تعديل ${doc} في حالة المسودة فقط.`, HttpStatus.CONFLICT, { doc }),
  overReceipt: (sku: string, remaining: string, requested: string) =>
    new AppException('OVER_RECEIPT', `Cannot receive ${requested} of ${sku}: only ${remaining} remains unreceived on the order.`, `لا يمكن استلام ${requested} من ${sku}: المتبقي غير المستلم على الطلب هو ${remaining} فقط.`, HttpStatus.UNPROCESSABLE_ENTITY, { sku, remaining, requested }),
  matchVarianceBlocked: (reasons: string[]) =>
    new AppException('MATCH_VARIANCE_BLOCKED', `Bill posting blocked by matching variances: ${reasons.join('; ')}.`, `تم منع ترحيل الفاتورة بسبب فروق المطابقة: ${reasons.join('؛ ')}.`, HttpStatus.UNPROCESSABLE_ENTITY, { reasons }),
  billNotPosted: (number: string) =>
    new AppException('BILL_NOT_POSTED', `Bill ${number} is not posted; payments can only apply to posted bills.`, `الفاتورة ${number} غير مرحّلة؛ لا يمكن تطبيق المدفوعات إلا على الفواتير المرحّلة.`, HttpStatus.UNPROCESSABLE_ENTITY, { number }),
  overBillAllocation: (number: string, outstanding: string, requested: string) =>
    new AppException('OVER_BILL_ALLOCATION', `Cannot allocate ${requested} to bill ${number}: outstanding is ${outstanding}.`, `لا يمكن تخصيص ${requested} لفاتورة المورد ${number}: المتبقي ${outstanding}.`, HttpStatus.UNPROCESSABLE_ENTITY, { number, outstanding, requested }),
  poApprovalRequired: (number: string, threshold: string) =>
    new AppException('PO_APPROVAL_REQUIRED', `Purchase order ${number} totals at or above ${threshold} and requires approval by someone other than the requester.`, `أمر الشراء ${number} يساوي أو يتجاوز ${threshold} ويتطلب اعتمادًا من شخص آخر غير الطالب.`, HttpStatus.FORBIDDEN, { number, threshold }),

  // ---------- Phase 8: finance ----------
  invalidFinanceTransition: (doc: string, from: string, to: string) =>
    new AppException('INVALID_FINANCE_TRANSITION', `Cannot transition ${doc} from ${from} to ${to}.`, `لا يمكن نقل ${doc} من ${from} إلى ${to}.`, HttpStatus.UNPROCESSABLE_ENTITY, { doc, from, to }),
  statementNotBalanced: (expected: string, actual: string) =>
    new AppException('STATEMENT_NOT_BALANCED', `Statement closing balance ${actual} does not equal opening plus lines (${expected}).`, `الرصيد الختامي للكشف ${actual} لا يساوي الافتتاحي مضافًا إليه الحركات (${expected}).`, HttpStatus.UNPROCESSABLE_ENTITY, { expected, actual }),
  matchAmountMismatch: (statementAmount: string, journalAmount: string) =>
    new AppException('MATCH_AMOUNT_MISMATCH', `Cannot match: statement line ${statementAmount} does not equal the journal amount ${journalAmount} (tolerance is zero).`, `لا يمكن المطابقة: سطر الكشف ${statementAmount} لا يساوي مبلغ القيد ${journalAmount} (التفاوت غير مسموح).`, HttpStatus.UNPROCESSABLE_ENTITY, { statementAmount, journalAmount }),
  alreadyMatched: () =>
    new AppException('ALREADY_MATCHED', 'This statement line is already matched to a journal entry.', 'سطر الكشف هذا مطابق بالفعل لقيد يومية.', HttpStatus.CONFLICT),
  notMatched: () =>
    new AppException('NOT_MATCHED', 'This statement line is not matched.', 'سطر الكشف هذا غير مطابق.', HttpStatus.CONFLICT),
  expenseAccountNotExpense: (code: string) =>
    new AppException('EXPENSE_ACCOUNT_NOT_EXPENSE', `Account ${code} is not an expense account.`, `الحساب ${code} ليس حساب مصروفات.`, HttpStatus.UNPROCESSABLE_ENTITY, { code }),
};
