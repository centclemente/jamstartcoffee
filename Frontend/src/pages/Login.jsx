import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import logoGreen from '../assets/logo_green.png'; // adjust this path if it errors

function getGreetingByTime() {
	const hour = new Date().getHours();

	if (hour < 12) return 'Good morning.';
	if (hour < 18) return 'Good afternoon.';
	return 'Good evening.';
}

function Login() {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showRequestForm, setShowRequestForm] = useState(false);
	const [requestEmail, setRequestEmail] = useState('');
	const [requestStatus, setRequestStatus] = useState('');
	const [requestError, setRequestError] = useState('');
	const [requesting, setRequesting] = useState(false);

	const { login } = useAuth();
	const navigate = useNavigate();
	const [greeting, setGreeting] = useState(getGreetingByTime());

	useEffect(() => {
		const updateGreeting = () => setGreeting(getGreetingByTime());
		updateGreeting();

		const intervalId = window.setInterval(updateGreeting, 60000);
		return () => window.clearInterval(intervalId);
	}, []);

	const handleSubmit = async (event) => {
		event.preventDefault();
		setError('');
		setSubmitting(true);
		try {
			await login(email, password);
			navigate('/dashboard');
		} catch (err) {
			setError(err.response?.data?.error || 'Login failed. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handlePasswordChangeRequest = async (event) => {
		event.preventDefault();
		setRequesting(true);
		setRequestError('');
		setRequestStatus('');

		try {
			const response = await api.post('/auth/password-change-requests', { email: requestEmail });
			setRequestStatus(response.data.message);
			setRequestEmail('');
		} catch (err) {
			setRequestError(err.response?.data?.error || 'Unable to submit your request.');
		} finally {
			setRequesting(false);
		}
	};

	return (
		<main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#EAF5CE_0%,#F6F4EE_55%)]">
			<div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(84,138,47,0.1)_1px,transparent_1px)] [background-size:22px_22px]" />

		<div className="relative mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
				<div className="w-full rounded-[2rem] border border-emerald-900/10 bg-white p-10 shadow-sm shadow-emerald-950/5 sm:p-14">
					<div className="mb-8 flex items-center gap-3">
						<img src={logoGreen} alt="Jamstart Coffee" className="h-9 w-auto" />
						<span className="text-sm tracking-wide text-[#4B6A3B]">Jamstart Coffee</span>
					</div>

					<h1
						className="mb-10 text-4xl leading-[1.05] text-[#16281C] sm:text-[2.75rem]"
						style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}
					>
						{greeting}
					</h1>
					{error && (
						<div className="mb-6 border-l-2 border-red-400 bg-red-50/80 px-4 py-3 text-sm text-red-700">
							{error}
						</div>
					)}

					<form className="space-y-7" onSubmit={handleSubmit}>
						<label className="block">
							<span className="text-xs uppercase tracking-[0.14em] text-[#6B8F4E]">Email</span>
							<input
								type="email"
								name="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@jamstartcoffee.com"
								required
								className="mt-2 w-full border-0 border-b border-[#16281C]/15 bg-transparent pb-2 text-base text-[#16281C] outline-none transition placeholder:text-[#16281C]/30 focus:border-[#6B8F4E]"
							/>
						</label>

						<label className="block">
							<span className="text-xs uppercase tracking-[0.14em] text-[#6B8F4E]">Password</span>
							<div className="mt-2 flex items-end border-b border-[#16281C]/15 pb-2 transition focus-within:border-[#6B8F4E]">
								<input
									type={showPassword ? 'text' : 'password'}
									name="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="Enter your password"
									required
									className="w-full border-0 bg-transparent text-base text-[#16281C] outline-none placeholder:text-[#16281C]/30"
								/>
								<button
									type="button"
									onClick={() => setShowPassword((prev) => !prev)}
									className="text-[#6B8F4E] transition hover:text-[#16281C]"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
								>
									{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</button>
							</div>
						</label>

						<button
							type="submit"
							disabled={submitting}
							className="group flex w-full items-center justify-center gap-2 bg-[#16281C] px-5 py-3.5 text-sm font-medium text-[#F4F6EC] transition hover:bg-[#20361F] disabled:cursor-not-allowed disabled:opacity-60"
						>
							{submitting ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									Signing in
								</>
							) : (
								<>
									Continue to dashboard
									<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
								</>
							)}
						</button>
					</form>

					<div className="mt-6 border-t border-[#16281C]/10 pt-5">
						<button
							type="button"
							onClick={() => {
								setShowRequestForm((prev) => !prev);
								setRequestError('');
								setRequestStatus('');
							}}
							className="text-sm text-[#4B6A3B] underline decoration-[#6B8F4E]/40 underline-offset-4 transition hover:text-[#16281C]"
						>
							{showRequestForm ? 'Cancel password change request' : 'Request a password change'}
						</button>

						{showRequestForm && (
							<form className="mt-4 space-y-4" onSubmit={handlePasswordChangeRequest}>
								<p className="text-sm leading-6 text-[#4B6A3B]">
									Enter your account email. An administrator will review the request and set a new password.
								</p>
								<input
									type="email"
									value={requestEmail}
									onChange={(event) => setRequestEmail(event.target.value)}
									placeholder="you@jamstartcoffee.com"
									required
									className="w-full border-0 border-b border-[#16281C]/15 bg-transparent pb-2 text-base text-[#16281C] outline-none transition placeholder:text-[#16281C]/30 focus:border-[#6B8F4E]"
								/>
								{requestError && <p className="text-sm text-red-700">{requestError}</p>}
								{requestStatus && <p className="text-sm text-[#4B6A3B]">{requestStatus}</p>}
								<button
									type="submit"
									disabled={requesting}
									className="w-full border border-[#16281C]/15 px-5 py-3 text-sm font-medium text-[#16281C] transition hover:bg-[#F4F6EC] disabled:cursor-not-allowed disabled:opacity-60"
								>
									{requesting ? 'Sending request...' : 'Send request to an administrator'}
								</button>
							</form>
						)}
					</div>

				</div>
			</div>
		</main>
	);
}

export default Login;