import { randomUUID, randomInt, randomBytes } from "node:crypto";
import identitiesData from "../test_data/identities.json";
import geographyData from "../test_data/geography.json";
import commerceData from "../test_data/commerce.json";
import utilityData from "../test_data/utility.json";
import phoneData from "../test_data/phone_data.json";

export class DataGenerators {
  private memoryBank: Map<string, string>;
  private runIdContext: string;
  private workerIdContext: string;

  constructor(
    runId: string = `RUN-${randomBytes(3).toString("hex")}`,
    workerId: string = "worker-1",
  ) {
    this.memoryBank = new Map<string, string>();
    this.runIdContext = runId;
    this.workerIdContext = workerId;
  }

  public resolve(template: string): string {
    if (!template || typeof template !== "string") return template;

    let resolvedString = template;

    const emailOverrideRegex =
      /([$@])randomEmail@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    resolvedString = resolvedString.replace(
      emailOverrideRegex,
      (match, mode, customDomain) => {
        if (mode === "$") {
          const freshEmail = this.randomEmail();
          this.memoryBank.set("randomEmail", freshEmail);
          const prefix = freshEmail.split("@")[0];
          return `${prefix}@${customDomain}`;
        } else {
          if (!this.memoryBank.has("randomEmail")) {
            throw new Error(
              `Framework Error: You tried to retrieve @randomEmail@${customDomain}, but no email was previously generated in this test.`,
            );
          }
          const lockedEmail = this.memoryBank.get("randomEmail") as string;
          const prefix = lockedEmail.split("@")[0];
          return `${prefix}@${customDomain}`;
        }
      },
    );

    const map = this.getMap();
    const variableRegex = /([$@])([a-zA-Z0-9_]+(?:\[[a-zA-Z]+\])?)/g;

    resolvedString = resolvedString.replace(
      variableRegex,
      (match, mode, varName) => {
        if (varName.startsWith("randomPair[")) {
          const typeMatch = varName.match(/\[([a-zA-Z]+)\]/);
          const type = typeMatch ? typeMatch[1] : null;
          if (!type) return match;

          if (mode === "$") {
            return this.generatePair(type);
          } else {
            return this.retrievePair(type, varName);
          }
        }

        const generator = map[varName];
        if (generator) {
          if (mode === "$") {
            const freshValue = generator();
            this.memoryBank.set(varName, freshValue);
            return freshValue;
          } else {
            if (!this.memoryBank.has(varName)) {
              throw new Error(
                `Framework Error: You tried to retrieve @${varName}, but no value was previously generated for it in this test.`,
              );
            }
            return this.memoryBank.get(varName) as string;
          }
        }

        return match;
      },
    );

    return resolvedString;
  }

  private pickRandom<T>(array: T[]): T {
    if (!array || array.length === 0) return "" as unknown as T;
    return array[randomInt(0, array.length)];
  }

  public uuid = () => randomUUID();
  public timestamp = () => Math.floor(Date.now() / 1000).toString();
  public isoTimestamp = () => new Date().toISOString();
  public randomIntStr = () => randomInt(1000, 99999).toString();
  public randomNumber = () => Math.floor(Math.random() * 1000000).toString();
  public randomString = () => randomBytes(4).toString("hex");
  public randomAlpha = () =>
    Math.random()
      .toString(36)
      .replace(/[^a-z]+/g, "")
      .substring(0, 6);
  public randomAlphaNumeric = () => Math.random().toString(36).substring(2, 10);

  public randomFirstName = () => this.pickRandom(identitiesData.firstNames);
  public randomLastName = () => this.pickRandom(identitiesData.lastNames);
  public randomFullName = () =>
    `${this.randomFirstName()} ${this.randomLastName()}`;
  public randomUsername = () =>
    `${this.randomFirstName().toLowerCase()}_flow_${this.randomIntStr()}`;
  public randomDisplayName = () =>
    `${this.randomFirstName()} ${this.randomLastName().charAt(0)}.`;
  public randomJobTitle = () => this.pickRandom(identitiesData.jobTitles);

  public randomEmail = () => {
    const defaultDomain = identitiesData.emailDomains[0];
    return `flow_${this.randomIntStr()}@${defaultDomain}`;
  };
  public randomDomain = () => identitiesData.emailDomains[0];

  private generateLocalizedPhone(prefix: string, length: number): string {
    const firstDigit = randomInt(1, 9).toString();
    let remainingDigits = "";
    for (let i = 1; i < length; i++) {
      remainingDigits += randomInt(0, 9).toString();
    }
    return `${prefix}${firstDigit}${remainingDigits}`;
  }

  public randomPhone = () => {
    const countryObj = this.pickRandom(geographyData.locations);
    const isoCode = countryObj.iso;

    const rules = (
      phoneData as Record<
        string,
        { code: string; length: number; prefix: string }
      >
    )[isoCode];
    if (!rules) return `+1${this.generateLocalizedPhone("", 10)}`;

    return this.generateLocalizedPhone(rules.prefix, rules.length);
  };

  public randomPhoneNG = () => `0${randomInt(7000000000, 9099999999)}`;

  public randomPassword = () => `P@ss${this.randomAlphaNumeric()}!`;
  public randomOtp = () => randomInt(100000, 999999).toString();
  public randomPin = () => randomInt(1000, 9999).toString();
  public randomToken = () =>
    randomBytes(32).toString("base64").substring(0, 24);

  public randomCountry = () => {
    const countryObj = this.pickRandom(geographyData.locations);
    return countryObj.country;
  };
  public randomState = () => {
    const countryObj = this.pickRandom(geographyData.locations);
    const stateObj = this.pickRandom(countryObj.states);
    return stateObj.name;
  };
  public randomCity = () => {
    const countryObj = this.pickRandom(geographyData.locations);
    const stateObj = this.pickRandom(countryObj.states);
    return this.pickRandom(stateObj.cities);
  };
  public randomStreet = () => `${randomInt(1, 99)} Admiralty Way`;
  public randomAddress = () => `${this.randomStreet()}, ${this.randomCity()}`;
  public randomZipCode = () => randomInt(10000, 99999).toString();

  private generatePair(type: string): string {
    const countryObj = this.pickRandom(geographyData.locations);
    const stateObj = this.pickRandom(countryObj.states);
    const city = this.pickRandom(stateObj.cities);

    const triplet = {
      Country: countryObj.country,
      State: stateObj.name,
      City: city,
    };
    this.memoryBank.set("lockedLocationPair", JSON.stringify(triplet));
    return (triplet as any)[type] || "";
  }

  private retrievePair(type: string, originalMatch: string): string {
    if (!this.memoryBank.has("lockedLocationPair")) {
      throw new Error(
        `Framework Error: You tried to retrieve @${originalMatch}, but no location pair was previously generated in this test.`,
      );
    }
    const lockedData = JSON.parse(
      this.memoryBank.get("lockedLocationPair") as string,
    );
    return lockedData[type] || "";
  }

  public today = () => new Date().toISOString().split("T")[0];
  public tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };
  public yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };
  public currentYear = () => new Date().getFullYear().toString();
  public currentMonth = () =>
    (new Date().getMonth() + 1).toString().padStart(2, "0");

  public randomCompany = () => this.pickRandom(commerceData.companies);
  public randomCurrency = () => this.pickRandom(commerceData.currencies);
  public randomAmount = () => {
    return (Math.random() * 10000).toFixed(2);
  };
  public randomTransactionId = () =>
    `TXN-${this.randomAlphaNumeric().toUpperCase()}`;

  public maliciousString = () => this.pickRandom(utilityData.maliciousStrings);
  public invalidEmail = () => this.pickRandom(utilityData.invalidEmails);
  public overflowString = () => this.pickRandom(utilityData.overflowStrings);
  public specialChars = () => this.pickRandom(utilityData.specialChars);

  public runId = () => this.runIdContext;
  public workerId = () => this.workerIdContext;

  public getMap(): Record<string, () => string> {
    return {
      uuid: this.uuid.bind(this),
      timestamp: this.timestamp.bind(this),
      isoTimestamp: this.isoTimestamp.bind(this),
      randomInt: this.randomIntStr.bind(this),
      randomNumber: this.randomNumber.bind(this),
      randomString: this.randomString.bind(this),
      randomAlpha: this.randomAlpha.bind(this),
      randomAlphaNumeric: this.randomAlphaNumeric.bind(this),
      randomFirstName: this.randomFirstName.bind(this),
      randomLastName: this.randomLastName.bind(this),
      randomFullName: this.randomFullName.bind(this),
      randomUsername: this.randomUsername.bind(this),
      randomDisplayName: this.randomDisplayName.bind(this),
      randomJobTitle: this.randomJobTitle.bind(this),
      randomEmail: this.randomEmail.bind(this),
      randomPhone: this.randomPhone.bind(this),
      randomPhoneNG: this.randomPhoneNG.bind(this),
      randomDomain: this.randomDomain.bind(this),
      randomPassword: this.randomPassword.bind(this),
      randomOtp: this.randomOtp.bind(this),
      randomPin: this.randomPin.bind(this),
      randomToken: this.randomToken.bind(this),
      randomCountry: this.randomCountry.bind(this),
      randomState: this.randomState.bind(this),
      randomCity: this.randomCity.bind(this),
      randomStreet: this.randomStreet.bind(this),
      randomAddress: this.randomAddress.bind(this),
      randomZipCode: this.randomZipCode.bind(this),
      today: this.today.bind(this),
      tomorrow: this.tomorrow.bind(this),
      yesterday: this.yesterday.bind(this),
      currentYear: this.currentYear.bind(this),
      currentMonth: this.currentMonth.bind(this),
      randomCompany: this.randomCompany.bind(this),
      randomAmount: this.randomAmount.bind(this),
      randomCurrency: this.randomCurrency.bind(this),
      randomTransactionId: this.randomTransactionId.bind(this),
      maliciousString: this.maliciousString.bind(this),
      invalidEmail: this.invalidEmail.bind(this),
      overflowString: this.overflowString.bind(this),
      specialChars: this.specialChars.bind(this),
      runId: this.runId.bind(this),
      workerId: this.workerId.bind(this),
    };
  }
}
