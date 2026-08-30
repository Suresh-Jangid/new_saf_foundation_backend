import { prisma } from "../../config/db";

export interface DashboardCountsOptions {
  userId?: string;
  role?: "ADMIN" | "AGENT";
}

export interface DashboardCountsResult {
  total_counts: {
    agent_registration: number;
    applications: number;
    application_insurance: number;
    disability_cycle: number;
    financial_help: number;
    loan_applications: number;
    marriage_congratulations: number;
    marriage_sewing_machine: number;
    pension_yojana: number;
    sewing_machine_camp: number;
    suraksha_bima_yojana: number;
    mayra_registration: number;
  };
  last_7_days_count: number;
}

export class DashboardService {
  public async getCounts(options: DashboardCountsOptions = {}): Promise<DashboardCountsResult> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const isAgent = options.role === "AGENT" && !!options.userId;
    const scopedWhere = isAgent
      ? { deletedAt: null, addedById: options.userId! }
      : { deletedAt: null };
    // SurakshaBimaYojana has no addedById of its own — ownership lives on the
    // InsuranceApplication it belongs to — so it needs its own scoped filter.
    const surakshaBimaWhere = isAgent
      ? { deletedAt: null, insuranceApplication: { addedById: options.userId! } }
      : { deletedAt: null };

    const [
      agent_registration,
      applications,
      application_insurance,
      disability_cycle,
      financial_help,
      loan_applications,
      marriage_congratulations,
      marriage_sewing_machine,
      pension_yojana,
      sewing_machine_camp,
      suraksha_bima_yojana,
      mayra_registration,
      last_7_days_count,
    ] = await Promise.all([
      isAgent
        ? Promise.resolve(0)
        : prisma.user.count({ where: { role: "AGENT", deletedAt: null } }),
      prisma.generalApplication.count({ where: scopedWhere }),
      prisma.insuranceApplication.count({ where: scopedWhere }),
      prisma.disabilityCycle.count({ where: scopedWhere }),
      prisma.financialHelp.count({ where: scopedWhere }),
      prisma.loanApplication.count({ where: scopedWhere }),
      prisma.marriageCongratulations.count({ where: scopedWhere }),
      prisma.marriageSewingMachine.count({ where: scopedWhere }),
      prisma.pensionYojana.count({ where: scopedWhere }),
      prisma.sewingMachineCamp.count({ where: scopedWhere }),
      prisma.surakshaBimaYojana.count({ where: surakshaBimaWhere }),
      prisma.mayraRegistration.count({ where: scopedWhere }),
      prisma.generalApplication.count({
        where: {
          ...scopedWhere,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
    ]);

    return {
      total_counts: {
        agent_registration,
        applications,
        application_insurance,
        disability_cycle,
        financial_help,
        loan_applications,
        marriage_congratulations,
        marriage_sewing_machine,
        pension_yojana,
        sewing_machine_camp,
        suraksha_bima_yojana,
        mayra_registration,
      },
      last_7_days_count,
    };
  }
}
