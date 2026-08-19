/**
 * ChatGPT Account Creator Automation Script
 * This script automates the creation of ChatGPT accounts using temporary browser data.
 * Converted from Python Playwright to Node.js Playwright.
 */

import { firefox } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { faker } from '@faker-js/faker';
import * as OTPAuth from 'otpauth';

class ChatGPTAccountCreator {
    constructor() {
        this.accountsFile = 'accounts.txt';
        this.createdAccounts = [];
        this.configFile = 'config.json';
        this.config = this.loadConfig();
        this.currentProgress = null;
    }

    log(message, level = null) {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        // Use currentProgress if available, otherwise use level or default to INFO
        let label;
        if (this.currentProgress) {
            label = this.currentProgress;
        } else if (level) {
            label = level;
        } else {
            label = "INFO";
        }
        const logMessage = `[${timestamp}] [${label}] ${message}`;
        console.log(logMessage);
    }

    loadConfig() {
        const defaultConfig = {
            max_workers: 3,
            headless: false,
            slow_mo: 1000,
            timeout: 30000,
            password: null
        };

        try {
            if (fs.existsSync(this.configFile)) {
                const configData = fs.readFileSync(this.configFile, 'utf-8');
                const config = JSON.parse(configData);
                Object.assign(defaultConfig, config);

                if (defaultConfig.password) {
                    const password = defaultConfig.password;
                    if (password.length < 12) {
                        this.log(`⚠️ Warning: Password in config.json is less than 12 characters. ChatGPT requires at least 12 characters.`, "WARNING");
                    }
                }

                return defaultConfig;
            } else {
                fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');
                this.log(`📝 Created default config file: ${this.configFile}`);
                return defaultConfig;
            }
        } catch (e) {
            this.log(`⚠️ Error loading config: ${e.message}, using defaults`, "WARNING");
            return defaultConfig;
        }
    }


    randstr(length) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async generateRandomEmail() {
        const TEMPMAIL_API = 'https://tempmail-store2003.levietcong2104.workers.dev';

        const response = await fetch(`${TEMPMAIL_API}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: 'edu.azxcd121.cloud' })
        });

        const data = await response.json();

        if (!data.success || !data.email) {
            throw new Error('Failed to create temp email from Cloudflare Worker');
        }

        // Extract domain from email (e.g. "user@azxcd121.cloud" → "azxcd121.cloud")
        const domain = data.email.split('@')[1];

        // Generate names for later use
        this.currentFirstName = faker.person.firstName().replace(/["']/g, '');
        this.currentLastName = faker.person.lastName().replace(/["']/g, '');

        this.log(`📧 Generated email: ${data.email}`);

        return {
            email: data.email,
            username: data.username,
            domain: domain
        };
    }


    generateRandomName() {
        // Use stored names from generateRandomEmail if available
        if (this.currentFirstName && this.currentLastName) {
            return `${this.currentFirstName} ${this.currentLastName}`;
        }

        // Fallback: generate new names using faker
        const firstName = faker.person.firstName().replace(/["']/g, '');
        const lastName = faker.person.lastName().replace(/["']/g, '');
        return `${firstName} ${lastName}`;
    }

    generateRandomAge() {
        return Math.floor(Math.random() * (50 - 18 + 1)) + 18; // Random age 18-50
    }

    saveAccount(email, password, totpSecret = null) {
        try {
            const account = { email, password, totpSecret };
            this.createdAccounts.push(account);
            const line = totpSecret
                ? `${email}|${password}|${totpSecret}\n`
                : `${email}|${password}\n`;
            fs.appendFileSync(this.accountsFile, line, 'utf-8');
            this.log(`💾 Saved account to ${this.accountsFile}: ${email}`);
        } catch (e) {
            this.log(`❌ Error saving account: ${e.message}`, "ERROR");
        }
    }

    async getVerificationCode(username, domain, maxRetries = 12, delay = 5) {
        const TEMPMAIL_API = 'https://tempmail-store2003.levietcong2104.workers.dev';

        if (!username || !domain) {
            this.log("❌ No username/domain provided for fetching verification code", "ERROR");
            return null;
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.log(`🔄 Checking inbox [${attempt}/${maxRetries}]...`);

                // Add cache-busting timestamp to avoid cached responses
                const response = await fetch(
                    `${TEMPMAIL_API}/api/emails/${username}?domain=${domain}&t=${Date.now()}`,
                    { method: 'GET', cache: 'no-store' }
                );

                const data = await response.json();

                if (data.success && data.emails && data.emails.length > 0) {
                    this.log(`📬 Found ${data.emails.length} email(s) in inbox for ${username}@${domain}`);

                    // Look for verification code in email subjects and bodies
                    for (const emailItem of data.emails) {
                        const subject = emailItem.subject || '';
                        const body = emailItem.body || '';

                        // Debug: show email details
                        this.log(`📧 Email: to=${emailItem.to} from=${emailItem.from} subject="${subject.substring(0, 50)}" receivedAt=${emailItem.receivedAt}`);

                        // Strip HTML tags to get plain text
                        const plainBody = body
                            .replace(/<[^>]*>/g, ' ')    // Remove HTML tags
                            .replace(/&nbsp;/g, ' ')      // Replace &nbsp;
                            .replace(/&amp;/g, '&')       // Replace &amp;
                            .replace(/\s+/g, ' ')         // Normalize whitespace
                            .trim();

                        this.log(`📧 Body (plain): ${plainBody.substring(0, 300)}`);

                        // Try multiple patterns to find the code
                        let code = null;

                        // Pattern 1: 6-digit code on its own line or after colon
                        const pattern1 = plainBody.match(/(?:code|verification|mã|xác nhận)[:\s]*(\d{6})/i);
                        if (pattern1) { code = pattern1[1]; }

                        // Pattern 2: standalone 6-digit number (most common)
                        if (!code) {
                            const pattern2 = plainBody.match(/\b(\d{6})\b/);
                            if (pattern2) { code = pattern2[1]; }
                        }

                        // Pattern 3: any 4-8 digit number
                        if (!code) {
                            const pattern3 = plainBody.match(/\b(\d{4,8})\b/);
                            if (pattern3) { code = pattern3[1]; }
                        }

                        // Pattern 4: digits after "continue" text
                        if (!code) {
                            const pattern4 = plainBody.match(/continue[:\s\n]*(\d{4,8})/i);
                            if (pattern4) { code = pattern4[1]; }
                        }

                        // Pattern 5: just find any 6 consecutive digits anywhere
                        if (!code) {
                            const pattern5 = plainBody.match(/(\d{6})/);
                            if (pattern5) { code = pattern5[1]; }
                        }

                        if (code) {
                            this.log(`✅ Retrieved verification code: ${code} (from: ${emailItem.from})`);
                            return code;
                        }
                    }

                    this.log(`⏳ Email received but no code found in content, retrying...`);
                } else {
                    this.log(`📭 Inbox empty for ${username}@${domain}, waiting ${delay}s...`);
                }

                if (attempt < maxRetries) {
                    await this.sleep(delay * 1000);
                }

            } catch (e) {
                this.log(`⚠️ Error fetching inbox (attempt ${attempt}/${maxRetries}): ${e.message}`, "WARNING");
                if (attempt < maxRetries) {
                    await this.sleep(delay * 1000);
                }
            }
        }

        this.log(`❌ Failed to get verification code after ${maxRetries} attempts`, "ERROR");
        return null;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    randomFloat(min, max) {
        return Math.random() * (max - min) + min;
    }

    async enable2FA(page, email) {
        const _BASE = "https://chatgpt.com/backend-api";

        try {
            // Step 1: Get access token from browser session
            this.log("🔐 Setting up 2FA...");
            const accessToken = await page.evaluate(async () => {
                try {
                    const res = await fetch('/api/auth/session');
                    const data = await res.json();
                    return data.accessToken || null;
                } catch {
                    return null;
                }
            });

            if (!accessToken) {
                this.log("❌ Could not get access token for 2FA", "ERROR");
                return null;
            }
            this.log("✅ Got access token");

            // Step 2: Enroll TOTP
            this.log("📝 Enrolling TOTP 2FA...");
            const enrollRes = await page.evaluate(async (token) => {
                try {
                    const res = await fetch('https://chatgpt.com/backend-api/accounts/mfa/enroll', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ factor_type: 'totp' }),
                    });
                    return { status: res.status, data: await res.json() };
                } catch (e) {
                    return { status: 0, error: e.message };
                }
            }, accessToken);

            if (enrollRes.status !== 200 || !enrollRes.data?.secret) {
                this.log(`❌ 2FA enroll failed: HTTP ${enrollRes.status} - ${JSON.stringify(enrollRes.data || enrollRes.error)}`, "ERROR");
                return null;
            }

            const secret = enrollRes.data.secret;
            const factorId = enrollRes.data.factor?.id;
            const sessionId = enrollRes.data.session_id;

            this.log(`✅ Enrolled: factor_id=${factorId?.substring(0, 20)}...`);

            // Step 3: Generate TOTP code
            const totp = new OTPAuth.TOTP({
                issuer: 'ChatGPT',
                label: email,
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: OTPAuth.Secret.fromBase32(secret),
            });
            const code = totp.generate();
            this.log(`🔑 Generated TOTP code: ${code}`);

            // Step 4: Activate enrollment
            this.log("⚡ Activating 2FA enrollment...");
            const activateRes = await page.evaluate(async ({ token, factorId, sessionId, code }) => {
                try {
                    const res = await fetch('https://chatgpt.com/backend-api/accounts/mfa/user/activate_enrollment', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            factor_id: factorId,
                            factor_type: 'totp',
                            session_id: sessionId,
                            code: code,
                        }),
                    });
                    return { status: res.status, data: await res.json().catch(() => ({})) };
                } catch (e) {
                    return { status: 0, error: e.message };
                }
            }, { token: accessToken, factorId, sessionId, code });

            if (activateRes.status === 200) {
                this.log("✅ 2FA activated successfully!");
                return {
                    secret: secret,
                    factor_id: factorId,
                    session_id: sessionId,
                    provisioning_uri: `otpauth://totp/ChatGPT?secret=${secret}&issuer=ChatGPT`,
                    first_code: code,
                };
            } else {
                // Check for idempotent response (already active)
                const bodyText = JSON.stringify(activateRes.data || '').toLowerCase();
                if (bodyText.includes('already') || bodyText.includes('active') || bodyText.includes('enabled')) {
                    this.log("✅ 2FA already active (idempotent)");
                    return {
                        secret: secret,
                        factor_id: factorId,
                        session_id: sessionId,
                        provisioning_uri: `otpauth://totp/ChatGPT?secret=${secret}&issuer=ChatGPT`,
                        first_code: code,
                    };
                }
                this.log(`❌ 2FA activate failed: HTTP ${activateRes.status} - ${JSON.stringify(activateRes.data)}`, "ERROR");
                return null;
            }

        } catch (e) {
            this.log(`❌ 2FA setup error: ${e.message}`, "ERROR");
            return null;
        }
    }

    async createAccount(accountNumber, totalAccounts) {
        // Set progress for logging
        this.currentProgress = `${accountNumber}/${totalAccounts}`;

        const emailInfo = await this.generateRandomEmail();
        const email = emailInfo.email;
        const emailUsername = emailInfo.username;
        const emailDomain = emailInfo.domain;
        const password = this.config.password;

        if (!password) {
            this.log("❌ Error: No password found in config.json! Please add a 'password' field to config.json", "ERROR");
            return false;
        }

        if (password.length < 12) {
            this.log(`⚠️ Warning: Password in config.json is only ${password.length} characters. ChatGPT requires at least 12 characters.`, "WARNING");
        }

        const name = this.generateRandomName();

        // this.log(`🚀 Creating account ${accountNumber}/${totalAccounts}: ${email}`);

        const uniqueId = uuidv4().substring(0, 8);
        const timestamp = Date.now();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `chatgpt_browser_${accountNumber}_${timestamp}_${uniqueId}_`));

        try {
            const firefoxVersion = "131.0";
            const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${firefoxVersion}) Gecko/20100101 Firefox/${firefoxVersion}`;

            const extraHttpHeaders = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
            };

            const firefoxUserPrefs = {
                'dom.webdriver.enabled': false,
                'useAutomationExtension': false,
                'marionette.enabled': false,
            };

            if (this.config.proxy) {
                const proxyUrl = new URL(this.config.proxy.server);
                firefoxUserPrefs['network.proxy.type'] = 1;
                firefoxUserPrefs['network.proxy.http'] = proxyUrl.hostname;
                firefoxUserPrefs['network.proxy.http_port'] = parseInt(proxyUrl.port);
                firefoxUserPrefs['network.proxy.ssl'] = proxyUrl.hostname;
                firefoxUserPrefs['network.proxy.ssl_port'] = parseInt(proxyUrl.port);
                firefoxUserPrefs['network.proxy.share_proxy_settings'] = true;
            }

            const contextOptions = {
                headless: this.config.headless !== false,
                viewport: { width: 1366, height: 768 },
                userAgent: userAgent,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                deviceScaleFactor: 0.9,
                hasTouch: false,
                isMobile: false,
                ignoreHTTPSErrors: true,
                bypassCSP: true,
                extraHTTPHeaders: extraHttpHeaders,
                firefoxUserPrefs: firefoxUserPrefs,
                timeout: 30000,
            };

            if (this.config.proxy) {
                contextOptions.proxy = {
                    server: this.config.proxy.server,
                    username: this.config.proxy.username,
                    password: this.config.proxy.password,
                };
                this.log(`Using proxy: ${this.config.proxy.server}`);
            }

            const context = await firefox.launchPersistentContext(tempDir, contextOptions);

            const pages = context.pages();
            const page = pages.length > 0 ? pages[0] : await context.newPage();

            const firefoxStealthScript = `
                (function() {
                    // Hide webdriver property (Firefox)
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                        configurable: true
                    });
                    
                    // Override plugins to look realistic
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => {
                            return {
                                length: 0,
                                item: function() { return null; },
                                namedItem: function() { return null; },
                                refresh: function() {}
                            };
                        },
                        configurable: true
                    });
                    
                    // Override languages
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['en-US', 'en'],
                        configurable: true
                    });
                    
                    // Override permissions query
                    const originalQuery = window.navigator.permissions.query;
                    if (originalQuery) {
                        window.navigator.permissions.query = (parameters) => (
                            parameters.name === 'notifications' ?
                                Promise.resolve({ state: Notification.permission }) :
                                originalQuery(parameters)
                        );
                    }
                    
                    // Remove automation indicators
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
                    
                    // Firefox-specific: Hide marionette
                    delete navigator.__marionette;
                    delete navigator.__fxdriver;
                    delete navigator._driver;
                    delete navigator._selenium;
                    delete navigator.__driver_evaluate;
                    delete navigator.__webdriver_evaluate;
                    delete navigator.__selenium_evaluate;
                    delete navigator.__fxdriver_evaluate;
                    delete navigator.__driver_unwrapped;
                    delete navigator.__webdriver_unwrapped;
                    delete navigator.__selenium_unwrapped;
                    delete navigator.__fxdriver_unwrapped;
                })();
            `;

            await page.addInitScript(firefoxStealthScript);

            // Step 1: Navigate to ChatGPT
            try {
                await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.sleep(2000);

                await page.evaluate(() => {
                    return {
                        webdriver: navigator.webdriver,
                        userAgent: navigator.userAgent,
                        languages: navigator.languages,
                        platform: navigator.platform,
                        plugins: navigator.plugins.length,
                        cookieEnabled: navigator.cookieEnabled,
                        onLine: navigator.onLine
                    };
                });

            } catch (e) {
                this.log(`❌ Error navigating to ChatGPT: ${e.message}`, "ERROR");
                return false;
            }
            // Click Sign up button - try multiple selectors
            this.log("🔘 Processing 'Sign up'");
            try {
                let signupButton = null;

                // Strategy 1: Find by role and text
                try {
                    signupButton = page.getByRole('link', { name: 'Sign up' });
                    await signupButton.waitFor({ state: 'visible', timeout: 5000 });
                } catch {
                    signupButton = null;
                }

                // Strategy 2: Find by button text
                if (!signupButton) {
                    try {
                        signupButton = page.getByRole('button', { name: 'Sign up' });
                        await signupButton.waitFor({ state: 'visible', timeout: 5000 });
                    } catch {
                        signupButton = null;
                    }
                }

                // Strategy 3: Find link with exact text
                if (!signupButton) {
                    try {
                        signupButton = page.locator('a:has-text("Sign up"), button:has-text("Sign up")').first();
                        await signupButton.waitFor({ state: 'visible', timeout: 5000 });
                    } catch {
                        signupButton = null;
                    }
                }

                // Strategy 4: Original XPath fallback
                if (!signupButton) {
                    try {
                        const signupButtonXPath = '/html/body/div[2]/div[1]/div/div[2]/div/header/div[3]/div[2]/div/div/div/button[2]/div';
                        signupButton = page.locator(`xpath=${signupButtonXPath}`);
                        await signupButton.waitFor({ state: 'visible', timeout: 10000 });
                    } catch {
                        signupButton = null;
                    }
                }

                if (!signupButton) {
                    this.log("❌ Could not find 'Sign up' button on page", "ERROR");
                    return false;
                }

                await this.sleep(1000);
                await signupButton.click({ timeout: 10000 });

                await this.sleep(this.randomFloat(1000, 2000));

                try {
                    const emailInputCheck = page.getByRole('textbox', { name: 'Email address' });
                    await emailInputCheck.waitFor({ state: 'visible', timeout: 5000 });
                } catch {
                    this.log("⚠️ Dialog might not have appeared, continuing anyway...", "WARNING");
                }

            } catch (e) {
                this.log(`❌ Error processing signup: ${e.message}`, "ERROR");
                return false;
            }

            // Fill email
            try {
                let emailInput = null;

                // Strategy 1: getByRole
                try {
                    emailInput = page.getByRole('textbox', { name: 'Email address' });
                    await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                } catch {
                    emailInput = null;
                }

                // Strategy 2: getByLabel
                if (!emailInput) {
                    try {
                        emailInput = page.getByLabel(/email/i).first();
                        await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                    } catch {
                        emailInput = null;
                    }
                }

                // Strategy 3: input[type="email"] or input[name*="email"]
                if (!emailInput) {
                    try {
                        emailInput = page.locator('input[type="email"], input[name*="email"], input[placeholder*="email" i]').first();
                        await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                    } catch {
                        emailInput = null;
                    }
                }

                if (!emailInput) {
                    this.log("❌ Could not find email input field", "ERROR");
                    return false;
                }

                await emailInput.fill(email);
                await emailInput.blur();

                await this.sleep(this.randomFloat(2000, 3000));

                const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
                await continueButton.waitFor({ state: 'visible', timeout: 10000 });

                const isEnabled = await continueButton.isEnabled();
                if (!isEnabled) {
                    this.log("⏳ Continue button not enabled yet, waiting for validation...");
                    await this.sleep(2000);
                }

                await this.sleep(this.randomFloat(500, 1000));

            } catch (e) {
                this.log(`❌ Error filling email: ${e.message}`, "ERROR");
                return false;
            }

            // =============================================
            // NEW FLOW: Email → Password → Code → Name/Age
            // =============================================

            // Step 1: Click Continue after email → goes to email-verification
            this.log("🔘 Step 1: Clicking Continue after email...");
            try {
                const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { }),
                    continueButton.click({ timeout: 10000 })
                ]);
                await this.sleep(2000);
                this.log(`📍 URL: ${page.url()}`);
            } catch (e) {
                this.log(`❌ Error clicking Continue: ${e.message}`, "ERROR");
                return false;
            }

            // Step 2: Click "Tiếp tục với mật khẩu" link → goes to /create-account/password
            this.log("🔑 Step 2: Clicking 'Tiếp tục với mật khẩu'...");
            try {
                const passwordLink = page.locator('a[href="/create-account/password"]').first();
                await passwordLink.waitFor({ state: 'visible', timeout: 10000 });
                await passwordLink.click({ timeout: 10000 });
                await this.sleep(2000);
                this.log(`📍 URL: ${page.url()}`);
            } catch (e) {
                this.log(`❌ Error clicking password link: ${e.message}`, "ERROR");
                return false;
            }

            // Step 3: Fill password on /create-account/password
            this.log("🔑 Step 3: Filling password...");
            try {
                const passwordInput = page.locator('input[type="password"]').first();
                await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
                await passwordInput.fill(password);
                await this.sleep(this.randomFloat(1000, 2000));
                this.log("✅ Password filled");
            } catch (e) {
                this.log(`❌ Error filling password: ${e.message}`, "ERROR");
                return false;
            }

            // Step 4: Click "Tiếp tục" button → goes back to email-verification
            this.log("🔘 Step 4: Clicking 'Tiếp tục' after password...");
            try {
                const submitBtn = page.locator('button[value="validate"], button[type="submit"]').first();
                await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
                await submitBtn.click({ timeout: 10000 });
                await this.sleep(3000);
                this.log(`📍 URL: ${page.url()}`);
            } catch (e) {
                this.log(`❌ Error clicking Continue after password: ${e.message}`, "ERROR");
                return false;
            }

            // Step 5: Get the NEWEST verification code from email
            this.log("⏳ Step 5: Getting verification code from email...");
            const verificationCode = await this.getVerificationCode(emailUsername, emailDomain);

            if (!verificationCode) {
                this.log(`❌ Failed to get verification code for ${email}`, "ERROR");
                await context.close();
                return false;
            }

            this.log(`✅ Got verification code: ${verificationCode}`);

            // Step 6: Enter verification code
            this.log("📝 Step 6: Entering verification code...");
            try {
                const codeInput = page.locator('input[name="code"]').first();
                await codeInput.waitFor({ state: 'visible', timeout: 10000 });

                // Use native React value setter
                await page.evaluate((code) => {
                    const input = document.querySelector('input[name="code"]');
                    if (input) {
                        input.focus();
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(input, code);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, verificationCode);
                await this.sleep(500);

                // Verify value
                const val = await codeInput.inputValue().catch(() => '');
                this.log(`🔍 Code input value: "${val}"`);

                // Fallback to keyboard type if needed
                if (!val || val.length < 4) {
                    await codeInput.click();
                    await page.keyboard.type(verificationCode, { delay: 200 });
                }
                await this.sleep(500);
            } catch (e) {
                this.log(`❌ Error entering code: ${e.message}`, "ERROR");
                return false;
            }

            // Step 7: Click "Tiếp tục" to submit code → goes to /about-you
            this.log("🔘 Step 7: Clicking 'Tiếp tục' to submit code...");
            try {
                const submitBtn = page.locator('button[value="validate"], button[type="submit"]').first();
                await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
                await submitBtn.click({ timeout: 10000 });

                // Wait for navigation to /about-you
                try {
                    await page.waitForURL('**/about-you**', { timeout: 15000 });
                    this.log(`✅ Navigated to: ${page.url()}`);
                } catch {
                    await this.sleep(3000);
                    this.log(`📍 URL: ${page.url()}`);
                }
            } catch (e) {
                this.log(`❌ Error submitting code: ${e.message}`, "ERROR");
                return false;
            }

            // =============================================
            // Step 8: Fill name and age on /about-you page
            // =============================================

            this.log(`📍 Current URL: ${page.url()}`);

            // Fill name
            this.log("📝 Step 8: Filling name...");
            try {
                let nameInput = null;
                try { nameInput = page.locator('input[name="name"]').first(); await nameInput.waitFor({ state: 'visible', timeout: 10000 }); } catch { nameInput = null; }
                if (!nameInput) { try { nameInput = page.getByPlaceholder(/họ và tên|full name/i).first(); await nameInput.waitFor({ state: 'visible', timeout: 5000 }); } catch { nameInput = null; } }
                if (!nameInput) { try { nameInput = page.locator('input[type="text"]').first(); await nameInput.waitFor({ state: 'visible', timeout: 5000 }); } catch { nameInput = null; } }

                if (!nameInput) {
                    this.log("❌ Could not find name input field", "ERROR");
                    return false;
                }

                await nameInput.fill(name);
                await this.sleep(500);
                this.log("✅ Name filled");
            } catch (e) {
                this.log(`❌ Error filling name: ${e.message}`, "ERROR");
                return false;
            }

            // Fill age
            const age = this.generateRandomAge();
            this.log(`🎂 Step 9: Setting age: ${age}`);
            try {
                let ageInput = null;
                try { ageInput = page.locator('input[name="age"]').first(); await ageInput.waitFor({ state: 'visible', timeout: 5000 }); } catch { ageInput = null; }
                if (!ageInput) { try { ageInput = page.getByPlaceholder(/tuổi|age/i).first(); await ageInput.waitFor({ state: 'visible', timeout: 5000 }); } catch { ageInput = null; } }
                if (!ageInput) { try { ageInput = page.locator('input[type="number"]').first(); await ageInput.waitFor({ state: 'visible', timeout: 5000 }); } catch { ageInput = null; } }

                if (!ageInput) {
                    this.log("❌ Could not find age input field", "ERROR");
                    return false;
                }

                await ageInput.fill(String(age));
                await this.sleep(500);
                this.log("✅ Age filled");
            } catch (e) {
                this.log(`❌ Error filling age: ${e.message}`, "ERROR");
                return false;
            }

            // Step 10: Click "Tiếp tục" to complete signup
            this.log("🔘 Step 10: Clicking 'Tiếp tục' to complete signup...");
            try {
                let submitBtn = null;
                try { submitBtn = page.locator('button[value="validate"]').first(); await submitBtn.waitFor({ state: 'visible', timeout: 5000 }); } catch { submitBtn = null; }
                if (!submitBtn) { try { submitBtn = page.locator('button[type="submit"]').first(); await submitBtn.waitFor({ state: 'visible', timeout: 5000 }); } catch { submitBtn = null; } }
                if (!submitBtn) { try { submitBtn = page.locator('button:has-text("Tiếp tục"), button:has-text("Continue")').first(); await submitBtn.waitFor({ state: 'visible', timeout: 5000 }); } catch { submitBtn = null; } }

                if (submitBtn) {
                    await submitBtn.click({ timeout: 10000 });
                    this.log("✅ Submit button clicked");
                }

                // Wait for navigation to chatgpt.com
                try {
                    await page.waitForURL(url => url.href.includes('chatgpt.com'), { timeout: 15000 });
                    this.log(`✅ Navigated to chatgpt.com!`);
                } catch {
                    await this.sleep(3000);
                }
                this.log(`📍 URL: ${page.url()}`);
            } catch (e) {
                this.log(`❌ Error completing signup: ${e.message}`, "ERROR");
                return false;
            }

            // Verify account creation and setup 2FA
            try {
                const currentUrl = page.url();
                // Account is created if we're on chatgpt.com OR successfully passed about-you
                const accountCreated = currentUrl.includes('chatgpt.com') || !currentUrl.includes('about-you');

                if (accountCreated) {
                    this.log(`✅ Account created successfully!`);

                    // Wait for page to settle on chatgpt.com
                    if (!currentUrl.includes('chatgpt.com')) {
                        this.log("⏳ Waiting for chatgpt.com...");
                        try {
                            await page.waitForURL(url => url.href.includes('chatgpt.com'), { timeout: 10000 });
                        } catch {
                            // Try navigating directly
                            await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                            await this.sleep(3000);
                        }
                    }

                    // Setup 2FA
                    let totpSecret = null;
                    try {
                        await this.sleep(3000); // Wait for session to settle
                        const mfaResult = await this.enable2FA(page, email);
                        if (mfaResult) {
                            totpSecret = mfaResult.secret;
                            this.log(`🔐 2FA enabled! Secret: ${totpSecret}`);
                            this.log(`📱 Provisioning URI: ${mfaResult.provisioning_uri}`);
                        } else {
                            this.log("⚠️ 2FA setup failed, saving account without 2FA", "WARNING");
                        }
                    } catch (mfaErr) {
                        this.log(`⚠️ 2FA error: ${mfaErr.message}`, "WARNING");
                    }

                    this.saveAccount(email, password, totpSecret);
                    await context.close();
                    return true;
                } else {
                    this.log(`⚠️ Unexpected URL after signup: ${currentUrl}`, "WARNING");
                    // Still try 2FA in case account was created
                    let totpSecret = null;
                    try {
                        // Try navigating to chatgpt.com first
                        await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                        await this.sleep(3000);
                        const mfaResult = await this.enable2FA(page, email);
                        if (mfaResult) {
                            totpSecret = mfaResult.secret;
                            this.log(`🔐 2FA enabled! Secret: ${totpSecret}`);
                        }
                    } catch (mfaErr) {
                        this.log(`⚠️ 2FA error: ${mfaErr.message}`, "WARNING");
                    }
                    this.saveAccount(email, password, totpSecret);
                    await context.close();
                    return true;
                }
            } catch (e) {
                this.log(`⚠️ Error verifying account creation: ${e.message}`, "WARNING");
                this.saveAccount(email, password);
                await context.close();
                return true;
            }

        } catch (e) {
            this.log(`💥 Unexpected error in createAccount: ${e.message}`, "ERROR");
            return false;
        } finally {
            try {
                await this.sleep(1000);
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    async createAccounts(numAccounts) {
        console.log(`🚀 Starting account creation for ${numAccounts} accounts...`);

        let successful = 0;
        let failed = 0;

        // Sequential processing - one account at a time
        for (let accountNum = 1; accountNum <= numAccounts; accountNum++) {
            // Set progress for logging
            this.currentProgress = `${accountNum}/${numAccounts}`;

            try {
                const success = await this.createAccount(accountNum, numAccounts);

                if (success) {
                    successful++;
                    this.log(`✅ Account completed successfully\n`);
                } else {
                    failed++;
                    this.log(`❌ Account failed\n`);
                }

                // Delay between accounts if not the last one
                if (accountNum < numAccounts) {
                    const delay = this.randomFloat(2000, 4000);
                    // this.log(`⏳ Waiting ${Math.round(delay / 1000)}s before next account...`);
                    await this.sleep(delay);
                }

            } catch (e) {
                this.log(`💥 Error: ${e.message}\n`);
                failed++;
            }
        }

        // Reset progress
        this.currentProgress = null;

        this.printSummary(successful, failed);
    }

    printSummary(successful, failed) {
        console.log("\n" + "=".repeat(60));
        console.log("📊 ACCOUNT CREATION SUMMARY");
        console.log("=".repeat(60));
        console.log(`✅ Successful: ${successful}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📝 Total accounts saved: ${this.createdAccounts.length}`);
        console.log(`💾 Accounts saved to: ${this.accountsFile}`);

        if (this.createdAccounts.length > 0) {
            console.log("\n✅ CREATED ACCOUNTS:");
            this.createdAccounts.forEach((account, i) => {
                const mfaStatus = account.totpSecret ? `🔐 2FA: ${account.totpSecret}` : "⚠️ No 2FA";
                console.log(`  ${i + 1}. ${account.email} | ${mfaStatus}`);
            });
        }

        console.log("=".repeat(60));
    }
}

async function main() {
    console.log("🤖 ChatGPT Account Creator");
    console.log("=".repeat(60));

    const creator = new ChatGPTAccountCreator();

    console.log(`⚙️ Configuration loaded`);
    // console.log(`   - Headless mode: ${creator.config.headless !== false}`);

    const password = creator.config.password;
    // if (password) {
    //     console.log(`   - Password: ${'*'.repeat(Math.min(password.length, 20))} (from config.json)`);
    // } else {
    //     console.log(`   - Password: ❌ NOT SET (please add 'password' to config.json)`);
    // }
    console.log();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const answer = await new Promise((resolve) => {
            rl.question("\n📝 How many accounts do you want to create? ", resolve);
        });

        const numAccounts = parseInt(answer, 10);
        if (isNaN(numAccounts) || numAccounts <= 0) {
            console.log("❌ Please enter a positive number!");
            rl.close();
            return;
        }

        console.log(`\n🚀 Starting creation of ${numAccounts} account(s)...`);
        console.log(`   Processing one account at a time (sequential mode)\n`);

        await creator.createAccounts(numAccounts);

    } catch (e) {
        if (e.message === 'readline was closed') {
            console.log("\n\n🛑 Script interrupted by user (Ctrl+C)");
            console.log("✅ Progress saved to accounts.txt");
        } else {
            console.log(`\n❌ Error: ${e.message}`);
        }
    } finally {
        rl.close();
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log("\n\n🛑 Script interrupted by user (Ctrl+C)");
    console.log("✅ Progress saved to accounts.txt");
    process.exit(0);
});

main().catch(console.error);
