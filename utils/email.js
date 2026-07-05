function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtTime(s) {
  const [h, m] = s.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

async function sendBookingConfirmation({ to, name, service, date, time, confirmationId }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return;

  const rows = [
    ['Service', service],
    ['Date',    fmtDate(date)],
    ['Time',    fmtTime(time)],
  ].map(([label, value]) => `
    <tr>
      <td style="padding:.65rem 0;border-bottom:1px solid #f0f0f0;color:#999;font-size:.83rem;font-weight:600;width:32%;vertical-align:top">${label}</td>
      <td style="padding:.65rem 0;border-bottom:1px solid #f0f0f0;color:#1c1c1c;font-size:.85rem;font-weight:700">${value}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:2rem 1rem;background:#f5f4f0;font-family:Inter,Arial,sans-serif">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09)">

    <!-- Header -->
    <div style="background:#1c1c1c;padding:1.5rem 2rem;text-align:center">
      <div style="color:#c8a96e;font-size:1.15rem;font-weight:800;letter-spacing:.06em">✂&nbsp; Haircut's R Us</div>
    </div>

    <!-- Gold confirmation bar -->
    <div style="background:#c8a96e;padding:1.25rem 2rem;text-align:center">
      <div style="font-size:1.5rem;font-weight:900;color:#1c1c1c;letter-spacing:-.02em">You're Booked ✓</div>
      <div style="font-size:.8rem;color:rgba(0,0,0,.55);margin-top:.25rem;font-weight:600;letter-spacing:.04em">
        CONFIRMATION #${String(confirmationId).padStart(5, '0')}
      </div>
    </div>

    <!-- Body -->
    <div style="padding:1.75rem 2rem">
      <p style="font-size:.95rem;color:#444;margin:0 0 1.5rem;line-height:1.6">
        Hey <strong>${name}</strong>, your appointment is confirmed. We can't wait to see you!
      </p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <p style="font-size:.8rem;color:#bbb;margin:1.5rem 0 0;line-height:1.5">
        Need to cancel or reschedule? Give us a call. We appreciate a heads-up!
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#fafafa;border-top:1px solid #eee;padding:1rem 2rem;text-align:center">
      <div style="font-size:.72rem;color:#ccc;letter-spacing:.02em">Haircut's R Us · Booking Confirmation</div>
    </div>

  </div>
</body>
</html>`;

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Haircut's R Us <${fromEmail}>`,
        to: [to],
        subject: `Booking Confirmed — ${service}`,
        html,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error('Resend error:', err);
    }
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
}

module.exports = { sendBookingConfirmation };
