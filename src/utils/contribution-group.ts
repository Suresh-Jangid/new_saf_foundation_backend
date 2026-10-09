/**
 * SAF FOUNDATION — STRICT CONTRIBUTION GROUP SEPARATION
 *
 * Four distinct groups:
 * 1. GM-300: General Marriage records with authoritative ₹300 installment.
 * 2. GM-1000: General Marriage records with authoritative ₹1000 installment.
 * 3. MAYRA-300: Mayra records with authoritative ₹300 installment.
 * 4. MAYRA-1000: Mayra records with authoritative ₹1000 installment.
 *
 * Strict Contribution Rules:
 * Contributions are allowed only when BOTH conditions match:
 * 1. Source and recipient belong to the same module.
 * 2. Source and recipient belong to the same installment group.
 *
 * Never infer the installment group from age slab, registration fee, totalAmount,
 * donation amount, or payment amount.
 * Legacy records with missing or ambiguous values fail safely.
 */

export type ContributionModule = 'general_marriage' | 'mayra';

export type ContributionGroup = 'GM-300' | 'GM-1000' | 'MAYRA-300' | 'MAYRA-1000';

/**
 * Resolves the authoritative installment group for General Marriage.
 * Authoritative field: GeneralApplication.installmentAmount (or MarriageCongratulations.installmentAmount)
 */
export function resolveGeneralMarriageGroup(installmentAmount: unknown): 'GM-300' | 'GM-1000' | null {
  if (installmentAmount === null || installmentAmount === undefined) {
    return null;
  }
  const numeric = typeof installmentAmount === 'number'
    ? installmentAmount
    : Number(String(installmentAmount).trim());

  if (numeric === 300) return 'GM-300';
  if (numeric === 1000) return 'GM-1000';
  return null;
}

/**
 * Resolves the authoritative installment group for Mayra.
 * Authoritative field: MayraRegistration.mayraInstallment
 */
export function resolveMayraGroup(mayraInstallment: unknown): 'MAYRA-300' | 'MAYRA-1000' | null {
  if (mayraInstallment === null || mayraInstallment === undefined) {
    return null;
  }
  const numeric = typeof mayraInstallment === 'number'
    ? mayraInstallment
    : Number(String(mayraInstallment).trim());

  if (numeric === 300) return 'MAYRA-300';
  if (numeric === 1000) return 'MAYRA-1000';
  return null;
}

/**
 * Returns the authoritative installment rate in INR for a validated contribution group.
 */
export function getExpectedInstallmentAmount(group: ContributionGroup): number {
  switch (group) {
    case 'GM-300':
    case 'MAYRA-300':
      return 300;
    case 'GM-1000':
    case 'MAYRA-1000':
      return 1000;
  }
}

/**
 * Validates that source and recipient meet strict contribution requirements:
 * 1. Same module
 * 2. Same authoritative installment group
 * Throws a descriptive Error with appropriate error message if validation fails.
 */
export function validateContributionGroupMatch(params: {
  sourceModule: ContributionModule;
  recipientModule: ContributionModule;
  sourceGroup: ContributionGroup | null;
  recipientGroup: ContributionGroup | null;
  sourceLabel?: string;
  recipientLabel?: string;
}): { group: ContributionGroup; expectedAmount: number } {
  const {
    sourceModule,
    recipientModule,
    sourceGroup,
    recipientGroup,
    sourceLabel = 'Source',
    recipientLabel = 'Recipient',
  } = params;

  // Rule 1: Cross-module prohibition
  if (sourceModule !== recipientModule) {
    throw new Error(
      `Cross-module contribution rejected: ${sourceLabel} belongs to ${sourceModule} whereas ${recipientLabel} belongs to ${recipientModule}. General Marriage and Mayra contribution pools are strictly separated.`
    );
  }

  // Rule 2: Safe handling of legacy/ambiguous records
  if (!sourceGroup) {
    throw new Error(
      `Legacy / ambiguous record: ${sourceLabel} does not have an authoritative ₹300 or ₹1000 installment group. Contribution blocked pending administrative review.`
    );
  }

  if (!recipientGroup) {
    throw new Error(
      `Legacy / ambiguous record: ${recipientLabel} does not have an authoritative ₹300 or ₹1000 installment group. Contribution blocked pending administrative review.`
    );
  }

  // Rule 3: Same installment group enforcement
  if (sourceGroup !== recipientGroup) {
    throw new Error(
      `Strict contribution group mismatch: ${sourceLabel} belongs to group ${sourceGroup} but ${recipientLabel} belongs to group ${recipientGroup}. Contributions between different installment groups are strictly prohibited.`
    );
  }

  return {
    group: sourceGroup,
    expectedAmount: getExpectedInstallmentAmount(sourceGroup),
  };
}
