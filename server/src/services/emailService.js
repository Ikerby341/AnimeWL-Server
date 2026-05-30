import axios from 'axios';
import nodemailer from 'nodemailer';

const frontendUrl = 'https://animewl.cat';

function getMailTransporter() {
	const host = process.env.EMAIL_SMTP_HOST;
	const port = Number(process.env.EMAIL_SMTP_PORT);
	const user = process.env.EMAIL_SMTP_USER;
	const pass = process.env.EMAIL_SMTP_PASS;
	const secure = process.env.EMAIL_SMTP_SECURE === 'true';

	if (!host || !user || !pass || !process.env.EMAIL_SMTP_PORT) {
		throw new Error('Faltan variables de entorno de correo electrÃ³nico (EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS)');
	}

	if (!Number.isInteger(port)) {
		throw new Error('EMAIL_SMTP_PORT debe ser un numero. Usa un solo puerto, por ejemplo 465 o 587.');
	}

	if (process.env.RENDER && [25, 465, 587].includes(port)) {
		console.warn(`Render puede bloquear el puerto SMTP ${port} en servicios gratuitos. Usa un plan de pago, una API HTTP de email o un proveedor SMTP con puerto alternativo como 2525.`);
	}

	return nodemailer.createTransport({
		host,
		port,
		secure,
		auth: {
			user,
			pass
		},
		connectionTimeout: 15000,
		greetingTimeout: 15000,
		socketTimeout: 15000
	});
}

function appUsesEmailRelay() {
	return Boolean(process.env.EMAIL_RELAY_URL && process.env.EMAIL_RELAY_SECRET);
}

async function sendMailThroughRelay({ to, subject, text, html }) {
	const relayUrl = process.env.EMAIL_RELAY_URL;
	const relaySecret = process.env.EMAIL_RELAY_SECRET;
	const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;

	if (!relayUrl || !relaySecret) {
		throw new Error('Faltan variables de entorno del relay de correo (EMAIL_RELAY_URL, EMAIL_RELAY_SECRET)');
	}

	const response = await axios.post(relayUrl, {
		secret: relaySecret,
		from,
		to,
		subject,
		text,
		html
	}, {
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: 15000
	});

	if (response.data && response.data.success === false) {
		throw new Error(response.data.error || 'El relay de correo devolvio un error');
	}
}

async function dispatchAppEmail({ to, subject, text, html }) {
	if (appUsesEmailRelay()) {
		return sendMailThroughRelay({ to, subject, text, html });
	}

	const transporter = getMailTransporter();
	const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;
	return transporter.sendMail({ from, to, subject, text, html });
}

function renderAnimeWlEmail({ title, intro, bodyHtml, buttonLabel = null, buttonUrl = null, footer }) {
	return `
		<div style="margin:0;padding:32px 16px;background-color:#0b0b0b;font-family:Arial,sans-serif;color:#ffffff;">
			<div style="max-width:620px;margin:0 auto;background-color:#111111;border:1px solid #222222;border-radius:20px;overflow:hidden;">
				<div style="padding:28px 32px;border-bottom:1px solid #1f1f1f;background-color:#000000;">
					<div style="font-size:30px;font-weight:800;line-height:1;color:#ffffff;">
						Anime<span style="color:#18c443;">WL</span>
					</div>
				</div>
				<div style="padding:32px;">
					<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#ffffff;">${title}</h1>
					<p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#f3f3f3;">${intro}</p>
					${bodyHtml}
					${buttonLabel && buttonUrl ? `
						<div style="margin:28px 0 12px;">
							<a
								href="${buttonUrl}"
								style="display:inline-block;padding:14px 22px;border-radius:12px;background-color:#209F36;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;"
							>${buttonLabel}</a>
						</div>
					` : ''}
					<p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#b0b0b0;">${footer}</p>
				</div>
			</div>
		</div>
	`;
}

export async function sendVerificationEmail(to, code) {
	const intro = 'Has solicitado verificar tu identidad para cambiar el correo electronico asociado a tu cuenta.';
	const bodyHtml = `
		<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#f3f3f3;">Introduce este codigo en la seccion de configuracion de AnimeWL:</p>
		<div style="display:inline-block;margin:8px 0 4px;padding:14px 20px;border-radius:14px;background-color:#000000;border:1px solid #2a2a2a;color:#18c443;font-size:32px;font-weight:800;letter-spacing:4px;">
			${code}
		</div>
	`;

	return dispatchAppEmail({
		to,
		subject: 'Codigo de verificacion para cambio de correo',
		text: `Tu codigo de verificacion es: ${code}. Introduce este codigo en la seccion de configuracion para cambiar tu correo electronico.`,
		html: renderAnimeWlEmail({
			title: 'Cambio de correo',
			intro,
			bodyHtml,
			footer: 'Si no has solicitado este cambio, puedes ignorar este correo sin hacer nada.'
		})
	});
}

export async function sendPasswordResetEmail(to, resetToken) {
	const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
	const intro = 'Hemos recibido una solicitud para restablecer la contraseÃ±a de tu cuenta de AnimeWL.';
	const bodyHtml = `
		<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#f3f3f3;">Pulsa el boton para crear una nueva contraseÃ±a de forma segura.</p>
		<p style="margin:0;font-size:14px;line-height:1.7;color:#b0b0b0;">Si el boton no funciona, copia y pega este enlace en tu navegador:</p>
		<p style="margin:10px 0 0;word-break:break-word;font-size:14px;line-height:1.7;color:#18c443;">${resetUrl}</p>
	`;

	return dispatchAppEmail({
		to,
		subject: 'Restablecer tu contraseÃ±a de AnimeWL',
		text: `Has solicitado restablecer tu contraseÃ±a. Haz clic en el siguiente enlace para crear una nueva contraseÃ±a: ${resetUrl}\n\nSi no solicitaste esto, ignora este correo.`,
		html: renderAnimeWlEmail({
			title: 'Restablecer contraseÃ±a',
			intro,
			bodyHtml,
			buttonLabel: 'Restablecer contraseÃ±a',
			buttonUrl: resetUrl,
			footer: 'Si no has solicitado este cambio, ignora este correo y tu contraseÃ±a seguirÃ¡ igual.'
		})
	});
}
