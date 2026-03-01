// monitor-netlify-credits.js
import { chromium } from 'playwright';

const NETLIFY_EMAIL     = process.env.NETLIFY_EMAIL;
const NETLIFY_PASSWORD  = process.env.NETLIFY_PASSWORD;
const NETLIFY_TEAM_SLUG = process.env.NETLIFY_TEAM_SLUG; // e.g. "my-team"
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // --- Log in ---
  await page.goto('https://app.netlify.com/login/email');
  await page.fill('input[name="email"]', NETLIFY_EMAIL);
  await page.fill('input[name="password"]', NETLIFY_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation();

  // --- Navigate to billing ---
  await page.goto(`https://app.netlify.com/teams/${NETLIFY_TEAM_SLUG}/billing/general`);

  // Wait for the credit balance section to be visible before reading it
  await page.waitForSelector(
    'section[aria-labelledby="card-title-Credit-balance"] em.tw-font-medium',
    { state: 'visible' }
  );

  // --- Extract credit usage ---
  const creditText = await page.$eval(
    'section[aria-labelledby="card-title-Credit-balance"] em.tw-font-medium',
    el => el.textContent
  );

  const match = creditText.match(/([\d,.]+)\s*\/\s*([\d,]+)/);

  if (!match) {
    throw new Error(`Could not parse credit usage from text: "${creditText}"`);
  }

  const used  = match[1]; // e.g. "516.4"
  const total = match[2]; // e.g. "3,000"

  const usedNum  = parseFloat(used.replace(/,/g, ''));
  const totalNum = parseInt(total.replace(/,/g, ''), 10);
  const percent  = Math.round((usedNum / totalNum) * 100);

  // Pick an emoji that reflects how close to the limit we are
  const emoji = percent >= 90 ? '🔴' : percent >= 75 ? '🟠' : percent >= 50 ? '🟡' : '🟢';

  await browser.close();

  // --- Post to Slack ---
  const billingUrl = `https://app.netlify.com/teams/${NETLIFY_TEAM_SLUG}/billing/overview`;
  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const message = {
    text: `${emoji} *Netlify Credits — ${now}*\n` +
          `Used: *${used}* / ${total} credits (*${percent}%*)\n` +
          `Remaining: *${(totalNum - usedNum).toLocaleString()}* credits\n` +
          `<${billingUrl}|View billing dashboard>`
  };

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
  }

  console.log(`✅ Posted to Slack: ${used} / ${total} credits (${percent}%)`);
})();
