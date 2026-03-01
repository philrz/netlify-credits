// monitor-netlify-credits.js
import { chromium } from 'playwright';

const NETLIFY_EMAIL     = process.env.NETLIFY_EMAIL;
const NETLIFY_PASSWORD  = process.env.NETLIFY_PASSWORD;
const NETLIFY_TEAM_SLUG = process.env.NETLIFY_TEAM_SLUG; // e.g. "my-team"
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// The three categories we care about — matched against the label text on the page
const CATEGORIES_OF_INTEREST = ['Production deploys', 'Bandwidth', 'Web requests'];

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

  // Wait for the credit balance section to be visible before reading anything
  await page.waitForSelector(
    'section[aria-labelledby="card-title-Credit-balance"] em.tw-font-medium',
    { state: 'visible' }
  );

  // --- Extract overall credit balance (used / total) ---
  const creditText = await page.$eval(
    'section[aria-labelledby="card-title-Credit-balance"] em.tw-font-medium',
    el => el.textContent
  );

  const balanceMatch = creditText.match(/([\d,.]+)\s*\/\s*([\d,]+)/);
  if (!balanceMatch) {
    throw new Error(`Could not parse credit balance from text: "${creditText}"`);
  }

  const used  = balanceMatch[1]; // e.g. "516.4"
  const total = balanceMatch[2]; // e.g. "3,000"

  const usedNum  = parseFloat(used.replace(/,/g, ''));
  const totalNum = parseInt(total.replace(/,/g, ''), 10);
  const percent  = Math.round((usedNum / totalNum) * 100);
  const remaining = (totalNum - usedNum).toLocaleString();

  // --- Extract per-category breakdown ---
  // Each <li> in the breakdown section has a label in its <p> elements and
  // a credit value in its <em class="tw-block">
  const allRows = await page.$$eval(
    'section[aria-labelledby="card-title-Credit-usage-breakdown"] ul.table-body li',
    items => items.map(li => {
      // The label lives in the left-side <p> element(s); em.tw-block holds the value.
      const valueEl = li.querySelector('em.tw-block');
      const valueText = valueEl ? valueEl.textContent.trim() : '';

      // Strip the value text from the full li text to isolate the label
      const fullText = li.textContent.trim();
      const label = fullText.replace(valueText, '').replace(/credits?/gi, '').trim();

      // Parse just the numeric part from the value (e.g. "360\ncredits" → "360")
      const valueMatch = valueText.match(/([\d,.]+)/);
      const value = valueMatch ? valueMatch[1] : '0';

      return { label, value };
    })
  );

  // Filter down to only the categories we care about
  const breakdown = CATEGORIES_OF_INTEREST.map(category => {
    const row = allRows.find(r => r.label.includes(category));
    return {
      label: category,
      value: row ? row.value : 'n/a'
    };
  });

  await browser.close();

  // --- Build Slack message ---
  const emoji = percent >= 90 ? '🔴' : percent >= 75 ? '🟠' : percent >= 50 ? '🟡' : '🟢';
  const billingUrl = `https://app.netlify.com/teams/${NETLIFY_TEAM_SLUG}/billing/overview`;
  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const breakdownLines = breakdown
    .map(({ label, value }) => `    • ${label}: *${value}* credits`)
    .join('\n');

  const message = {
    text:
      `${emoji} *Netlify Credits — ${now}*\n` +
      `Used: *${used}* / ${total} credits (*${percent}%*) — Remaining: *${remaining}*\n` +
      `Breakdown:\n${breakdownLines}\n` +
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
  console.log('Breakdown:', breakdown);
})();