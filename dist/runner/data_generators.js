"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataGenerators = void 0;
const node_crypto_1 = require("node:crypto");
const identities_json_1 = __importDefault(require("../test_data/identities.json"));
const geography_json_1 = __importDefault(require("../test_data/geography.json"));
const commerce_json_1 = __importDefault(require("../test_data/commerce.json"));
const utility_json_1 = __importDefault(require("../test_data/utility.json"));
const phone_data_json_1 = __importDefault(require("../test_data/phone_data.json"));
class DataGenerators {
    memoryBank;
    runIdContext;
    workerIdContext;
    constructor(runId = `RUN-${(0, node_crypto_1.randomBytes)(3).toString("hex")}`, workerId = "worker-1") {
        this.memoryBank = new Map();
        this.runIdContext = runId;
        this.workerIdContext = workerId;
    }
    resolve(template) {
        if (!template || typeof template !== "string")
            return template;
        let resolvedString = template;
        const emailOverrideRegex = /([$@])randomEmail@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
        resolvedString = resolvedString.replace(emailOverrideRegex, (match, mode, customDomain) => {
            if (mode === "$") {
                const freshEmail = this.randomEmail();
                this.memoryBank.set("randomEmail", freshEmail);
                const prefix = freshEmail.split("@")[0];
                return `${prefix}@${customDomain}`;
            }
            else {
                if (!this.memoryBank.has("randomEmail")) {
                    throw new Error(`Framework Error: You tried to retrieve @randomEmail@${customDomain}, but no email was previously generated in this test.`);
                }
                const lockedEmail = this.memoryBank.get("randomEmail");
                const prefix = lockedEmail.split("@")[0];
                return `${prefix}@${customDomain}`;
            }
        });
        const map = this.getMap();
        const variableRegex = /([$@])([a-zA-Z0-9_]+(?:\[[a-zA-Z]+\])?)/g;
        resolvedString = resolvedString.replace(variableRegex, (match, mode, varName) => {
            if (varName.startsWith("randomPair[")) {
                const typeMatch = varName.match(/\[([a-zA-Z]+)\]/);
                const type = typeMatch ? typeMatch[1] : null;
                if (!type)
                    return match;
                if (mode === "$") {
                    return this.generatePair(type);
                }
                else {
                    return this.retrievePair(type, varName);
                }
            }
            const generator = map[varName];
            if (generator) {
                if (mode === "$") {
                    const freshValue = generator();
                    this.memoryBank.set(varName, freshValue);
                    return freshValue;
                }
                else {
                    if (!this.memoryBank.has(varName)) {
                        throw new Error(`Framework Error: You tried to retrieve @${varName}, but no value was previously generated for it in this test.`);
                    }
                    return this.memoryBank.get(varName);
                }
            }
            return match;
        });
        return resolvedString;
    }
    pickRandom(array) {
        if (!array || array.length === 0)
            return "";
        return array[(0, node_crypto_1.randomInt)(0, array.length)];
    }
    uuid = () => (0, node_crypto_1.randomUUID)();
    timestamp = () => Math.floor(Date.now() / 1000).toString();
    isoTimestamp = () => new Date().toISOString();
    randomIntStr = () => (0, node_crypto_1.randomInt)(1000, 99999).toString();
    randomNumber = () => Math.floor(Math.random() * 1000000).toString();
    randomString = () => (0, node_crypto_1.randomBytes)(4).toString("hex");
    randomAlpha = () => Math.random()
        .toString(36)
        .replace(/[^a-z]+/g, "")
        .substring(0, 6);
    randomAlphaNumeric = () => Math.random().toString(36).substring(2, 10);
    randomFirstName = () => this.pickRandom(identities_json_1.default.firstNames);
    randomLastName = () => this.pickRandom(identities_json_1.default.lastNames);
    randomFullName = () => `${this.randomFirstName()} ${this.randomLastName()}`;
    randomUsername = () => `${this.randomFirstName().toLowerCase()}_flow_${this.randomIntStr()}`;
    randomDisplayName = () => `${this.randomFirstName()} ${this.randomLastName().charAt(0)}.`;
    randomJobTitle = () => this.pickRandom(identities_json_1.default.jobTitles);
    randomEmail = () => {
        const defaultDomain = identities_json_1.default.emailDomains[0];
        return `flow_${this.randomIntStr()}@${defaultDomain}`;
    };
    randomDomain = () => identities_json_1.default.emailDomains[0];
    generateLocalizedPhone(prefix, length) {
        const firstDigit = (0, node_crypto_1.randomInt)(1, 9).toString();
        let remainingDigits = "";
        for (let i = 1; i < length; i++) {
            remainingDigits += (0, node_crypto_1.randomInt)(0, 9).toString();
        }
        return `${prefix}${firstDigit}${remainingDigits}`;
    }
    randomPhone = () => {
        const countryObj = this.pickRandom(geography_json_1.default.locations);
        const isoCode = countryObj.iso;
        const rules = phone_data_json_1.default[isoCode];
        if (!rules)
            return `+1${this.generateLocalizedPhone("", 10)}`;
        return this.generateLocalizedPhone(rules.prefix, rules.length);
    };
    randomPhoneNG = () => `0${(0, node_crypto_1.randomInt)(7000000000, 9099999999)}`;
    randomPassword = () => `P@ss${this.randomAlphaNumeric()}!`;
    randomOtp = () => (0, node_crypto_1.randomInt)(100000, 999999).toString();
    randomPin = () => (0, node_crypto_1.randomInt)(1000, 9999).toString();
    randomToken = () => (0, node_crypto_1.randomBytes)(32).toString("base64").substring(0, 24);
    randomCountry = () => {
        const countryObj = this.pickRandom(geography_json_1.default.locations);
        return countryObj.country;
    };
    randomState = () => {
        const countryObj = this.pickRandom(geography_json_1.default.locations);
        const stateObj = this.pickRandom(countryObj.states);
        return stateObj.name;
    };
    randomCity = () => {
        const countryObj = this.pickRandom(geography_json_1.default.locations);
        const stateObj = this.pickRandom(countryObj.states);
        return this.pickRandom(stateObj.cities);
    };
    randomStreet = () => `${(0, node_crypto_1.randomInt)(1, 99)} Admiralty Way`;
    randomAddress = () => `${this.randomStreet()}, ${this.randomCity()}`;
    randomZipCode = () => (0, node_crypto_1.randomInt)(10000, 99999).toString();
    generatePair(type) {
        const countryObj = this.pickRandom(geography_json_1.default.locations);
        const stateObj = this.pickRandom(countryObj.states);
        const city = this.pickRandom(stateObj.cities);
        const triplet = {
            Country: countryObj.country,
            State: stateObj.name,
            City: city,
        };
        this.memoryBank.set("lockedLocationPair", JSON.stringify(triplet));
        return triplet[type] || "";
    }
    retrievePair(type, originalMatch) {
        if (!this.memoryBank.has("lockedLocationPair")) {
            throw new Error(`Framework Error: You tried to retrieve @${originalMatch}, but no location pair was previously generated in this test.`);
        }
        const lockedData = JSON.parse(this.memoryBank.get("lockedLocationPair"));
        return lockedData[type] || "";
    }
    today = () => new Date().toISOString().split("T")[0];
    tomorrow = () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split("T")[0];
    };
    yesterday = () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().split("T")[0];
    };
    currentYear = () => new Date().getFullYear().toString();
    currentMonth = () => (new Date().getMonth() + 1).toString().padStart(2, "0");
    randomCompany = () => this.pickRandom(commerce_json_1.default.companies);
    randomCurrency = () => this.pickRandom(commerce_json_1.default.currencies);
    randomAmount = () => {
        return (Math.random() * 10000).toFixed(2);
    };
    randomTransactionId = () => `TXN-${this.randomAlphaNumeric().toUpperCase()}`;
    maliciousString = () => this.pickRandom(utility_json_1.default.maliciousStrings);
    invalidEmail = () => this.pickRandom(utility_json_1.default.invalidEmails);
    overflowString = () => this.pickRandom(utility_json_1.default.overflowStrings);
    specialChars = () => this.pickRandom(utility_json_1.default.specialChars);
    runId = () => this.runIdContext;
    workerId = () => this.workerIdContext;
    getMap() {
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
exports.DataGenerators = DataGenerators;
