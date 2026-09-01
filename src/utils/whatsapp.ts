import axios from "axios";

/**
 * Authoritative Hindi Scheme Display Names
 */
export const SCHEME_HINDI_NAMES: Record<string, string> = {
  GENERAL: "विवाह योजना",
  GENERAL_MARRIAGE: "विवाह योजना",
  MARRIAGE: "विवाह योजना",
  MAYRA: "मायरा योजना",
  INSURANCE: "बीमा योजना",
  INSURANCE_BIMA: "बीमा योजना",
  JANNI_DELIVERY: "जन्नी डिलीवरी योजना",
  AAWAS: "आवास योजना",
  LADO_BAHIN: "लाडो बहिन योजना",
  DHUNDHOTSAV: "धुंधोत्सव योजना",
  SHUBHLAXMI: "शुभलक्ष्मी योजना",
  SHUBH_LAXMI: "शुभलक्ष्मी योजना",
};

/**
 * Resolves scheme key/code to its authoritative Hindi display name
 */
export function resolveSchemeDisplayName(schemeKey: string): string {
  if (!schemeKey) return "योजना";
  const normalized = schemeKey.trim().toUpperCase().replace(/[-\s]/g, "_");
  return SCHEME_HINDI_NAMES[normalized] || schemeKey;
}

export interface SchemeThankYouParams {
  applicantName: string;
  applicationNumber: string;
  schemeName: string;
}

/**
 * Formats the standardized SAF Foundation Thank-You Message
 */
export function formatSchemeThankYouMessage(params: SchemeThankYouParams): string {
  const schemeName = resolveSchemeDisplayName(params.schemeName);
  return `नमस्ते ${params.applicantName},\n\n**SAF Foundation शिक्षा अमृतम फाउंडेशन** के ${schemeName}\n(आवेदन सं. ${params.applicationNumber}) में जुड़ने के लिए आपका बहुत बहुत धन्यवाद 🙏\n\nअधिक जानकारी हेतु संपर्क करें:\n**शिक्षा अमृतम फाउंडेशन**\n\n+91 8107054565\n+91 8619484745\n+91 8432863996\n\ninfo@shikshaamritamfoundation.org`;
}

/**
 * Green API WhatsApp Integration Service
 */
export class WhatsAppService {
  private static apiUrl = process.env.GREEN_API_URL || "https://7107.api.greenapi.com";
  private static idInstance = process.env.GREEN_API_ID_INSTANCE || "710722703877";
  private static apiTokenInstance = process.env.GREEN_API_TOKEN_INSTANCE || "8155475884b747f7bab0529dc014374b6ad307fd15b241ad8a";


  /**
   * Format standard mobile number into Green API chatId format (e.g. 919876543210@c.us)
   */
  public static formatChatId(toMobile: string): string {
    let clean = toMobile.replace(/\D/g, "");
    if (clean.length === 10) {
      clean = `91${clean}`;
    }
    return clean.endsWith("@c.us") ? clean : `${clean}@c.us`;
  }

  /**
   * Send text message via Green API
   */
  public static async sendTextMessage(toMobile: string, message: string) {
    try {
      const chatId = this.formatChatId(toMobile);
      const url = `${this.apiUrl}/waInstance${this.idInstance}/sendMessage/${this.apiTokenInstance}`;

      console.log(`Sending WhatsApp message to ${chatId} via Green API...`);

      const response = await axios.post(
        url,
        {
          chatId,
          message,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      console.log(`✅ WhatsApp message sent successfully to ${chatId}. IdMessage:`, response.data?.idMessage);
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error(
        "❌ Error sending WhatsApp message via Green API:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Send dynamic standardized scheme registration thank-you message
   */
  public static async sendSchemeRegistrationThankYou(
    toMobile: string,
    params: SchemeThankYouParams
  ) {
    if (!toMobile) return { success: false, error: "No mobile provided" };
    const message = formatSchemeThankYouMessage(params);
    return this.sendTextMessage(toMobile, message);
  }

  /**
   * Send WhatsApp Template/Event Notification via Green API
   */
  public static async sendTemplateMessage(
    toMobile: string,
    templateName: string,
    _languageCode: string = "en",
    parameters: Array<{ type: string; text: string }> = []
  ) {
    let messageText = "";

    if (templateName === "otp_verification" && parameters.length > 0) {
      const otp = parameters[0]?.text || "";
      messageText = `🔐 *Purabiya Foundation Verification*\n\nYour OTP for verification is: *${otp}*\n\nThis OTP is valid for 5 minutes. Please do not share it with anyone.`;
    } else {
      const paramText = parameters.map((p) => p.text).join(" ");
      messageText = `📢 *Purabiya Foundation Notification*\n\n${paramText || templateName}`;
    }

    return this.sendTextMessage(toMobile, messageText);
  }

  /**
   * Send file/document (e.g. PDF Bond) via Green API sendFileByUpload
   */
  public static async sendFileByUpload(
    toMobile: string,
    fileBuffer: Buffer,
    fileName: string,
    caption?: string
  ): Promise<{ success: boolean; data?: any; error?: any }> {
    try {
      if (!toMobile) return { success: false, error: "No mobile provided" };
      if (!fileBuffer || fileBuffer.length === 0) return { success: false, error: "Empty file buffer" };

      const chatId = this.formatChatId(toMobile);
      const url = `${this.apiUrl}/waInstance${this.idInstance}/sendFileByUpload/${this.apiTokenInstance}`;

      console.log(`Sending WhatsApp file (${fileName}) to ${chatId} via Green API...`);

      const formData = new FormData();
      formData.append("chatId", chatId);
      formData.append("fileName", fileName);
      if (caption) {
        formData.append("caption", caption);
      }
      formData.append(
        "file",
        new Blob([fileBuffer], { type: "application/pdf" }),
        fileName
      );

      const response = await axios.post(url, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 30000,
      });

      console.log(`✅ WhatsApp file sent successfully to ${chatId}. IdMessage:`, response.data?.idMessage);
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error(
        "❌ Error sending WhatsApp file via Green API:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }
}
