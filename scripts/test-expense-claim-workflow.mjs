import assert from 'node:assert/strict';
import {
    expenseClaimMatchesFilter,
    expenseClaimStatusMeta,
    expenseReviewerActions
} from '../js/utils/expenseClaimWorkflow.js';

const personalSubmitted = { status: 'submitted', category: 'energy', fundingSource: 'personal' };
assert.equal(expenseClaimStatusMeta(personalSubmitted).label, '待審核');
assert.deepEqual(expenseReviewerActions(personalSubmitted), ['approve', 'reject']);

const personalApproved = { status: 'approved', category: 'daily_supplies', fundingSource: 'personal' };
assert.equal(expenseClaimStatusMeta(personalApproved).label, '待處理');
assert.deepEqual(expenseReviewerActions(personalApproved), ['pay', 'rent_deduction', 'reject']);

const pettyApproved = { status: 'approved', category: 'daily_supplies', fundingSource: 'petty_cash' };
assert.deepEqual(expenseReviewerActions(pettyApproved), ['confirm', 'reject']);

const incomeApproved = { status: 'approved', category: 'petty_cash_income', fundingSource: 'petty_cash' };
assert.deepEqual(expenseReviewerActions(incomeApproved), ['confirm', 'reject']);

assert.equal(expenseClaimStatusMeta({ ...personalApproved, status: 'reimbursed', settlementMethod: 'rent_deduction' }).label, '從房費扣除');
assert.equal(expenseClaimStatusMeta({ ...pettyApproved, status: 'reimbursed', settlementMethod: 'petty_cash' }).label, '零用金已支出');
assert.equal(expenseClaimStatusMeta({ ...incomeApproved, status: 'reimbursed', settlementMethod: 'income_confirmed' }).label, '收入已確認');
assert.equal(expenseClaimMatchesFilter(personalSubmitted, 'review'), true);
assert.equal(expenseClaimMatchesFilter(personalApproved, 'action'), true);
assert.equal(expenseClaimMatchesFilter(personalSubmitted, 'pending'), true);
assert.equal(expenseClaimMatchesFilter(personalApproved, 'pending'), true);
assert.equal(expenseClaimMatchesFilter({ ...personalApproved, status: 'reimbursed' }, 'completed'), true);

console.log('expense claim workflow regression checks passed');
