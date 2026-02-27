export default async function handler(req, res) {
    // Only allow GET requests for the cron job
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 1. Verify Vercel Cron Secret
    // Vercel sends `Authorization: Bearer <CRON_SECRET>`
    const authHeader = req.headers.authorization;
    if (
        process.env.NODE_ENV !== 'development' &&
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
        console.error('Unauthorized cron request');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!AIRTABLE_TOKEN || !BASE_ID || !TABLE_ID || !RESEND_API_KEY) {
        console.error('Missing required environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // 2. Fetch approved applications without welcome email
        // Formula checks for Status="Approved" and Email Sent checkbox being empty/false
        const formula = "AND(TRIM({Application Status}) = 'Approved', NOT({Approval Email Sent}))";
        const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodeURIComponent(formula)}`;

        const airtableResponse = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!airtableResponse.ok) {
            const errorData = await airtableResponse.json();
            throw new Error(`Airtable fetch error: ${JSON.stringify(errorData)}`);
        }

        const { records } = await airtableResponse.json();

        if (!records || records.length === 0) {
            return res.status(200).json({ message: 'No new approved applications found.', results: { attempted: 0 } });
        }

        const results = {
            attempted: records.length,
            successes: 0,
            failures: 0
        };

        // 3. Process each record
        for (const record of records) {
            const email = record.fields.Email;
            const name = record.fields.Name || 'there';

            if (!email) {
                console.warn(`Record ${record.id} has no email address. Skipping.`);
                results.failures++;
                continue;
            }

            try {
                // 4. Send Email via Resend
                const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <p style="font-size: 16px;">Hi ${name},</p>
  
  <p>Thank you for applying to join our members-only community.</p>

  <p>We’re pleased to let you know that you’ve been accepted into SwapSpace and now have full access to the platform.</p>

  <p>As a new member, you’ve earned <strong>7 SwapCredit</strong>, which allows you to travel before you host making it easier to plan your first swap with confidence.</p>

  <p><strong>To get started, just follow these simple steps:</strong></p>
  <p><strong>Step 1:</strong> Enter your first and last name, then create and confirm your password.</p>
  <p><strong>Step 2:</strong> Check your inbox and click the verification link we send you, this will take you straight into the platform.</p>
  <p><strong>Step 3:</strong> Complete your home listing so other members can discover you.</p>
  <p><strong>Step 4:</strong> Finish the quick identity verification to activate your profile fully.</p>
  <p>SwapSpace is a members-only community, and every member lists their home even if they plan to travel first. You can upload photos, add details, and edit everything at any time.</p>
  <p>If you have any questions along the way, just reply to this email we’re happy to help.</p>

  <a
    href="https://app.swap-space.com/signup"
    style="
      display: inline-flex;
      align-items: center;
      width: fit-content;
      gap: 6px;
      margin-top: 12px;
      padding: 12px 24px;
      background-color: #079455;
      color: #fff;
      font-size: 14px;
      font-weight: 400;
      font-family: 'General Sans', sans-serif;
      text-decoration: none;
      border-radius: 40px;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease;
    "
  >
    Create your SwapSpace account
  </a>

  <p>To make setup easy, we’ve also put together simple step-by-step guides:</p>
  <a href="https://blog.swap-space.com/2025/11/15/how-to-list-your-home-on-swapspace/">How to list your home on SwapSpace</a><br>
  <a href="https://www.swap-space.com/guides-pages/photoguidelines">Photo upload guidelines</a>

  <p>If anything is unclear, you can <a href="https://calendly.com/olakunle-swap-space/swapspace-research">book a live onboarding call</a> and we’ll walk you through it or simply reply to this email.</p>
  
  <p style="margin-top: 30px;">
    Warmly,<br>
    <strong><a href="https://www.swap-space.com/">The SwapSpace Team</a></strong>
  </p>
  
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  
  <p style="font-size: 12px; color: #888; text-align: center;">
    SwapSpace Europe LTD<br>
    82a James Carter Road Mildenhall IP28 7DE, United Kingdom<br>
    ©${new Date().getFullYear()} SwapSpace. All rights reserved.
  </p>
</body>
</html>
        `;

                const emailResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'SwapSpace <hello@notifications.swap-space.com>',
                        reply_to: 'hello@swap-space.com',
                        to: email,
                        subject: 'Update on your application | Welcome to SwapSpace',
                        html: emailHtml
                    })
                });

                if (!emailResponse.ok) {
                    const emailErr = await emailResponse.json();
                    console.error(`Resend error for ${email}:`, emailErr);
                    results.failures++;
                    continue; // skip updating Airtable if email fails to send
                }

                console.log(`Successfully sent approval email to ${email}`);

                // 5. Update Airtable to mark as sent
                const updateResponse = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${record.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fields: {
                            "Approval Email Sent": true
                        }
                    })
                });

                if (!updateResponse.ok) {
                    const updateErr = await updateResponse.json();
                    console.error(`Airtable update error for ${record.id}:`, updateErr);
                    results.failures++;
                } else {
                    results.successes++;
                }
            } catch (err) {
                console.error(`Error processing record ${record.id}:`, err);
                results.failures++;
            }
        }

        return res.status(200).json({ message: 'Cron job completed', results });

    } catch (error) {
        console.error('Cron job error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
