import { PrismaClient, Role, Gender, ApplicationCategory } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting Database Seeding...");

  // Generate common hashed password: password123
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash("password123", salt);

  // 1. Create Default Admin User
  const adminMobile = "9999999999";
  let admin = await prisma.user.findFirst({ where: { mobile: adminMobile } });
  if (admin) {
    admin = await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash },
    });
  } else {
    admin = await prisma.user.create({
      data: {
        name: "Super Admin",
        mobile: adminMobile,
        email: "admin@purabiya.org",
        passwordHash: passwordHash,
        role: Role.ADMIN,
        isActive: true,
      },
    });
  }
  console.log(`✅ Admin Account Upserted: ${admin.name} (${admin.mobile})`);

  // 2. Create Default Agent User
  const agentMobile = "8888888888";
  let agent = await prisma.user.findFirst({ where: { mobile: agentMobile } });
  if (agent) {
    agent = await prisma.user.update({
      where: { id: agent.id },
      data: { passwordHash, role: Role.AGENT, isActive: true, deletedAt: null },
    });
  } else {
    agent = await prisma.user.create({
      data: {
        name: "Default Agent",
        mobile: agentMobile,
        email: "agent@purabiya.org",
        passwordHash: passwordHash,
        role: Role.AGENT,
        isActive: true,
      },
    });
  }
  console.log(`✅ Agent Account Upserted: ${agent.name} (${agent.mobile})`);

  // 3. Create Agent Profile
  await prisma.agentProfile.upsert({
    where: { userId: agent.id },
    update: {},
    create: {
      userId: agent.id,
      employeeId: "EMP001",
      fatherName: "Mr. Agent Father",
      gotra: "Prajapat",
      age: 30,
      gender: Gender.Male,
      village: "Jasal",
      address: "Near Temple, Village Jasal",
      tehsil: "Balotra",
      district: "Balotra",
      workArea: "Balotra Block",
      bankName: "State Bank of India",
      accountNumber: "12345678901",
      ifscCode: "SBIN0001234",
      nomineeName: "Nominee Agent",
      nomineeMobile: "9876543210",
      nomineeRelation: "Wife",
    },
  });
  console.log(`✅ Agent Profile Created for: ${agent.name}`);

  // 4. Create Agent Permissions
  const modules = [
    "dashboard",
    "applicant_registration",
    "mayra_registration",
    "payment_management",
    "marriage_congratulations_payment",
    "suraksha_bima_yojana_payment",
    "bulk_marriage_emi",
    "bulk_suraksha_bima_emi",
    "bulk_mayra_emi",
  ];

  for (const mod of modules) {
    await prisma.agentPermission.upsert({
      where: {
        userId_module: {
          userId: agent.id,
          module: mod,
        },
      },
      update: {},
      create: {
        userId: agent.id,
        module: mod,
        canView: true,
        canCreate: mod === "mayra_registration" || mod === "applicant_registration" ? true : false,
        canUpdate: mod === "mayra_registration" || mod === "applicant_registration" ? true : false,
        canDelete: false,
      },
    });
  }
  console.log("✅ Agent Permissions Seeding Completed.");

  // 5. Seed General Applications from local json file
  let jsonPath = path.join(__dirname, "tableConvert.com_ydwbkp.json");
  if (!fs.existsSync(jsonPath)) {
    jsonPath = path.join(__dirname, "tableConvert.com_deayne.json");
  }
  console.log(`🌱 Loading General Applications from: ${jsonPath}`);
  
  if (fs.existsSync(jsonPath)) {
    try {
      let fileContent = fs.readFileSync(jsonPath, "utf8");
      
      // Skip the URL on the first line if present
      const firstBrace = fileContent.indexOf('{');
      const firstBracket = fileContent.indexOf('[');
      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        fileContent = fileContent.substring(firstBrace);
      }

      const parsedJson = JSON.parse(fileContent);
      const rows = Array.isArray(parsedJson) ? parsedJson : (parsedJson.data || []);
      console.log(`✅ Loaded ${rows.length} rows from JSON file.`);
      
      // Cache existing users to map agents
      const existingUsers = await prisma.user.findMany({
        select: { id: true, name: true, mobile: true, role: true }
      });
      
      const userByMobile = new Map<string, string>();
      const userByName = new Map<string, string>();
      for (const u of existingUsers) {
        if (u.mobile) userByMobile.set(u.mobile.trim(), u.id);
        if (u.name) userByName.set(u.name.trim().toLowerCase(), u.id);
      }
      
      // Helpers
      const parseDate = (val: any): Date => {
        if (!val) return new Date();
        if (val instanceof Date) return val;
        if (typeof val === "string") {
          val = val.trim();
          if (!val) return new Date();
          if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val);
          const parts = val.split(/[-/]/);
          if (parts.length === 3) {
            if (parts[2].length === 4) {
              const part0 = parseInt(parts[0], 10);
              const part1 = parseInt(parts[1], 10);
              const year = parseInt(parts[2], 10);
              return new Date(year, part0 - 1, part1);
            } else if (parts[2].length === 2) {
              const part0 = parseInt(parts[0], 10);
              const part1 = parseInt(parts[1], 10);
              let year = parseInt(parts[2], 10);
              if (year < 100) year += 2000;
              return new Date(year, part0 - 1, part1);
            } else if (parts[0].length === 4) {
              const year = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              const day = parseInt(parts[2], 10);
              return new Date(year, month, day);
            }
          }
        }
        const parsed = new Date(val);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
      };
      
      const mapGender = (val: any): Gender => {
        const raw = String(val || "").trim().toLowerCase();
        if (raw.includes("female") || raw.includes("महिला") || raw.includes("स्त्री")) {
          return Gender.Female;
        }
        if (raw.includes("male") || raw.includes("पुरुष") || raw.includes("मर्द्")) {
          return Gender.Male;
        }
        return Gender.Other;
      };
      
      const mapCategory = (val: any): ApplicationCategory => {
        const raw = String(val || "").trim().toUpperCase();
        if (raw === "A" || raw === "B" || raw === "C") return raw as ApplicationCategory;
        return ApplicationCategory.A;
      };
      
      const getFeeByCategory = (category: ApplicationCategory): number => {
        if (category === ApplicationCategory.A) return 3000;
        if (category === ApplicationCategory.B) return 6000;
        if (category === ApplicationCategory.C) return 9000;
        return 3000;
      };

      // Resolve/Create agents
      const resolvedAgentIds = new Map<string, string>();
      for (const row of rows) {
        const agentName = String(row["कार्यकर्ता का नाम"] || row["added_name"] || "").trim();
        const agentMobile = String(row["कार्यकर्ता का मोबाइल"] || row["added_mobile"] || "").trim().replace(/\D/g, "");
        if (agentName || agentMobile) {
          const key = agentMobile || agentName;
          if (!resolvedAgentIds.has(key)) {
            let agentId = agentMobile ? userByMobile.get(agentMobile) : userByName.get(agentName.toLowerCase());
            if (!agentId) {
              // Create agent if not found
              if (agentMobile) {
                console.log(`🌱 Creating new agent user for seed: ${agentName} (${agentMobile})`);
                const agentCount = await prisma.agentProfile.count();
                const employeeId = `EMP-${String(agentCount + 1).padStart(3, "0")}`;
                
                const newUser = await prisma.$transaction(async (tx) => {
                  const user = await tx.user.create({
                    data: {
                      name: agentName,
                      mobile: agentMobile,
                      passwordHash,
                      role: Role.AGENT,
                      isActive: true,
                    },
                  });
                  
                  await tx.agentProfile.create({
                    data: {
                      userId: user.id,
                      employeeId,
                      fatherName: "Default",
                      gotra: "Prajapat",
                      age: 25,
                      gender: Gender.Male,
                      village: "",
                      address: "",
                      tehsil: "",
                      district: "",
                      workArea: "",
                      bankName: "",
                      accountNumber: "",
                      ifscCode: "",
                      nomineeName: "",
                      nomineeMobile: "",
                      nomineeRelation: "",
                      registrationDate: new Date(),
                    },
                  });
                  
                  const defaultModules = [
                    "dashboard",
                    "agent_registration",
                    "applicant_registration",
                    "mayra_registration",
                    "payment_management",
                    "marriage_congratulations_payment",
                    "suraksha_bima_yojana_payment",
                    "bulk_marriage_emi",
                    "bulk_suraksha_bima_emi",
                    "bulk_mayra_emi",
                  ];
                  
                  await tx.agentPermission.createMany({
                    data: defaultModules.map((mod) => ({
                      userId: user.id,
                      module: mod,
                      canView: true,
                      canCreate: mod.includes("registration"),
                      canUpdate: mod.includes("registration"),
                      canDelete: false,
                    })),
                  });
                  return user;
                });
                
                userByMobile.set(agentMobile, newUser.id);
                userByName.set(agentName.toLowerCase(), newUser.id);
                agentId = newUser.id;
              } else {
                agentId = admin.id;
              }
            }
            resolvedAgentIds.set(key, agentId!);
          }
        }
      }

      // Determine starting form number
      const existingApps = await prisma.generalApplication.findMany({
        select: { formNumber: true, aadharNumber: true, applicantName: true, mobile: true }
      });
      const existingFormNumbers = new Set(existingApps.map(app => app.formNumber.trim()));
      const existingAadhars = new Set(existingApps.map(app => app.aadharNumber.trim()));
      const existingNameMobiles = new Set(existingApps.map(app => `${app.applicantName.trim().toLowerCase()}_${app.mobile.trim()}`));

      let maxFormNum = 0;
      for (const formNum of existingFormNumbers) {
        const match = formNum.match(/GA-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxFormNum) maxFormNum = num;
        }
      }
      let currentFormSuffix = maxFormNum + 1;

      // Seed General Applications
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const applicantName = String(row["आवेदक का नाम"] || row["applicantName"] || "").trim();
        const fatherName = String(row["पिता का नाम"] || row["fatherName"] || "").trim();
        const aadharNumber = String(row["आधार संख्या"] || row["aadharNumber"] || "").trim().replace(/\D/g, "");
        const mobile = String(row["मोबाइल"] || row["mobile"] || "").trim().replace(/\D/g, "");

        if (!applicantName || !fatherName || !aadharNumber) {
          continue;
        }

        const nameMobileKey = `${applicantName.toLowerCase()}_${mobile}`;
        if (existingAadhars.has(aadharNumber) || existingNameMobiles.has(nameMobileKey)) {
          console.log(`ℹ️ General Application for ${applicantName} already exists. Skipping.`);
          continue;
        }

        const appDate = parseDate(row["आवेदन तिथि"] || row["applicationDate"]);
        const motherName = String(row["माता का नाम"] || row["motherName"] || "").trim();
        const dob = parseDate(row["जन्म तिथि"] || row["dateOfBirth"]);
        const gotra = String(row["गोत्र"] || row["gotra"] || "Prajapat").trim();
        const address = String(row["गाँव"] || row["address"] || "").trim();
        const pinCode = String(row["पिन कोड"] || row["pinCode"] || "").trim();
        const tehsil = String(row["तहसील"] || row["tehsil"] || "").trim();
        const district = String(row["जिला"] || row["district"] || "").trim();
        const state = String(row["राज्य"] || row["state"] || "").trim();
        const nomineeName = (row["नामिनी का नाम"] || row["nomineeName"]) ? String(row["नामिनी का नाम"] || row["nomineeName"]).trim() : null;
        const nomineeRelation = (row["नामिनी का सम्बन्ध"] || row["nomineeRelation"]) ? String(row["नामिनी का सम्बन्ध"] || row["nomineeRelation"]).trim() : null;
        
        const gender = mapGender(row["लिंग"] || row["gender"]);
        const category = mapCategory(row["श्रेणी"] || row["category"]);
        const totalAmount = row["totalAmount"] ? Number(row["totalAmount"]) : getFeeByCategory(category);

        const agentName = String(row["कार्यकर्ता का नाम"] || row["added_name"] || "").trim();
        const agentMobile = String(row["कार्यकर्ता का मोबाइल"] || row["added_mobile"] || "").trim().replace(/\D/g, "");
        const agentKey = agentMobile || agentName;
        const addedById = resolvedAgentIds.get(agentKey) || admin.id;

        const isActive = row["Active"] !== undefined 
          ? String(row["Active"] || "Yes").trim().toLowerCase().startsWith("y")
          : (row["is_active"] === 1 || row["is_active"] === true || row["is_active"] === undefined);

        const formNumber = row["formNumber"] || row["आवेदन संख्या"] || `GA-${String(currentFormSuffix++).padStart(4, "0")}`;

        console.log(`🌱 Seeding General Application: ${formNumber} - ${applicantName}`);
        await prisma.generalApplication.create({
          data: {
            id: randomUUID(),
            formNumber,
            applicationDate: appDate,
            applicantName,
            fatherName,
            motherName,
            dateOfBirth: dob,
            aadharNumber,
            gotra,
            mobile,
            address,
            pinCode,
            tehsil,
            district,
            state,
            nomineeName,
            nomineeRelation,
            gender,
            category,
            totalAmount,
            pendingAmount: totalAmount,
            isActive,
            addedById,
          }
        });
      }
      console.log("✅ General Applications Seeding Completed.");

      // Seed Insurance Applications
      console.log("🌱 Seeding Insurance Applications...");
      // Query existing Aadhars / Names to avoid duplication
      const existingInsurances = await prisma.insuranceApplication.findMany({
        select: { aadharNumber: true, applicantName: true, mobile: true }
      });
      const existingInsAadhars = new Set(existingInsurances.map((app) => app.aadharNumber));
      const existingInsNameMobiles = new Set(
        existingInsurances.map((app) => `${app.applicantName.toLowerCase()}_${app.mobile}`)
      );

      // Get last form number index
      const existingInsuranceApps = await prisma.insuranceApplication.findMany({
        select: { formNumber: true }
      });
      let maxInsFormNum = 0;
      for (const app of existingInsuranceApps) {
        if (app.formNumber && app.formNumber.startsWith("INS-")) {
          const num = parseInt(app.formNumber.replace("INS-", ""), 10);
          if (!isNaN(num) && num > maxInsFormNum) maxInsFormNum = num;
        }
      }
      let currentInsFormSuffix = maxInsFormNum + 1;

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const applicantName = String(row["आवेदक का नाम"] || row["applicantName"] || "").trim();
        const fatherName = String(row["पिता का नाम"] || row["fatherName"] || "").trim();
        const aadharNumber = String(row["आधार संख्या"] || row["aadharNumber"] || "").trim().replace(/\D/g, "");
        const mobile = String(row["मोबाइल"] || row["mobile"] || "").trim().replace(/\D/g, "");

        if (!applicantName || !fatherName || !aadharNumber) {
          continue;
        }

        const nameMobileKey = `${applicantName.toLowerCase()}_${mobile}`;
        if (existingInsAadhars.has(aadharNumber) || existingInsNameMobiles.has(nameMobileKey)) {
          console.log(`ℹ️ Insurance Application for ${applicantName} already exists. Skipping.`);
          continue;
        }

        const appDate = parseDate(row["आवेदन तिथि"] || row["applicationDate"]);
        const motherName = String(row["माता का नाम"] || row["motherName"] || "").trim();
        const dob = parseDate(row["जन्म तिथि"] || row["dateOfBirth"]);
        const gotra = String(row["गोत्र"] || row["gotra"] || "Prajapat").trim();
        const address = String(row["गाँव"] || row["address"] || "").trim();
        const pinCode = String(row["पिन कोड"] || row["pinCode"] || "").trim();
        const tehsil = String(row["तहसील"] || row["tehsil"] || "").trim();
        const district = String(row["जिला"] || row["district"] || "").trim();
        const state = String(row["राज्य"] || row["state"] || "").trim();
        const nomineeName = (row["नामिनी का नाम"] || row["nomineeName"]) ? String(row["नामिनी का नाम"] || row["nomineeName"]).trim() : null;
        const nomineeRelation = (row["नामिनी का सम्बन्ध"] || row["nomineeRelation"]) ? String(row["नामिनी का सम्बन्ध"] || row["nomineeRelation"]).trim() : null;
        
        const gender = mapGender(row["लिंग"] || row["gender"]);
        const category = mapCategory(row["श्रेणी"] || row["category"]);
        const totalAmount = row["totalAmount"] ? Number(row["totalAmount"]) : getFeeByCategory(category);

        const agentName = String(row["कार्यकर्ता का नाम"] || row["added_name"] || "").trim();
        const agentMobile = String(row["कार्यकर्ता का मोबाइल"] || row["added_mobile"] || "").trim().replace(/\D/g, "");
        const agentKey = agentMobile || agentName;
        const addedById = resolvedAgentIds.get(agentKey) || admin.id;

        const isActive = row["Active"] !== undefined 
          ? String(row["Active"] || "Yes").trim().toLowerCase().startsWith("y")
          : (row["is_active"] === 1 || row["is_active"] === true || row["is_active"] === undefined);

        const formNumber = row["formNumber"]?.replace(/^(GA|M|F)-/, "INS-") || `INS-${String(currentInsFormSuffix++).padStart(4, "0")}`;

        console.log(`🌱 Seeding Insurance Application: ${formNumber} - ${applicantName}`);
        await prisma.insuranceApplication.create({
          data: {
            id: randomUUID(),
            formNumber,
            applicationDate: appDate,
            applicantName,
            fatherName,
            motherName,
            dateOfBirth: dob,
            aadharNumber,
            gotra,
            mobile,
            address,
            pinCode,
            tehsil,
            district,
            state,
            nomineeName,
            nomineeRelation,
            gender,
            category,
            totalAmount,
            pendingAmount: totalAmount,
            isActive,
            addedById,
          }
        });
      }
      console.log("✅ Insurance Applications Seeding Completed.");
    } catch (err: any) {
      console.error(`❌ Error parsing or seeding Applications: ${err.message}`);
    }
  } else {
    console.log(`⚠️ JSON seed file not found at ${jsonPath}`);
  }

  console.log("🌱 Database Seeding Completed Successfully.");
}

main()
  .catch((e) => {
    console.error("❌ Seeding Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
