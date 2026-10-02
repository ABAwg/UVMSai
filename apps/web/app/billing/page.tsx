'use client';

import Image from 'next/image';
import { useSession } from '@/lib/use-session';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, CreditCard, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { API_URL, apiFetch, authHeaders, jsonOrThrow, readWebSession } from '@/lib/api';

type Plan = {
  code: string;
  name: string;
  monthly_price_cents: number;
  currency: string;
  limits: Record<string, number>;
};

type Subscription = {
  plan_code: string;
  plan_name: string;
  status: string;
  provider?: string | null;
  current_period_end?: string | null;
  monthly_price_cents: number;
  currency: string;
};

type Checkout = {
  id: string;
  plan_code: string;
  provider: string;
  status: string;
  amount_cents: number;
  currency: string;
  checkout_url?: string | null;
  created_at: string;
};

const money = (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`;

export default function BillingPage() {
  const [session] = useSession();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [access, setAccess] = useState('');
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [billingProvider, setBillingProvider] = useState('');

  const load = useCallback(async (token: string) => {
    if (!token) { setError('Sign in before managing your subscription.'); return; }
    try {
      const [planRows, current, capabilities] = await Promise.all([
        jsonOrThrow<Plan[]>(await apiFetch(`${API_URL}/plans`, { headers: authHeaders(token) })),
        jsonOrThrow<Subscription>(await apiFetch(`${API_URL}/billing/subscription`, { headers: authHeaders(token) })),
        jsonOrThrow<{billing_enabled?: boolean; billing_provider?: string}>(await apiFetch(`${API_URL}/capabilities`, { headers: authHeaders(token) })),
      ]);
      setPlans(planRows); setSubscription(current); setBillingEnabled(Boolean(capabilities.billing_enabled)); setBillingProvider(capabilities.billing_provider || ''); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load billing'); }
  }, []);

  useEffect(() => {
    if (!session) return;
    setAccess(session.access); void load(session.access);
  }, [load, session]);

  async function startCheckout(plan: Plan) {
    if (!access || plan.code === subscription?.plan_code || plan.code === 'free') return;
    setBusy(plan.code); setError(''); setNotice(''); setCheckout(null);
    try {
      const created = await jsonOrThrow<Checkout>(await apiFetch(`${API_URL}/billing/checkout`, {
        method: 'POST', headers: authHeaders(access), body: JSON.stringify({ plan_code: plan.code }),
      }));
      setCheckout(created);
      if (created.provider !== 'demo' && created.checkout_url) window.location.href = created.checkout_url;
    } catch (e) { setError(e instanceof Error ? e.message : 'Checkout could not be created'); }
    finally { setBusy(''); }
  }

  async function completeDemo() {
    if (!access || !checkout) return;
    setBusy('demo'); setError('');
    try {
      const completed = await jsonOrThrow<Checkout>(await apiFetch(`${API_URL}/billing/demo/complete/${checkout.id}`, {
        method: 'POST', headers: authHeaders(access),
      }));
      setCheckout(completed);
      setNotice('Demo payment completed. Your plan is active across Web and Mobile.');
      await load(access);
    } catch (e) { setError(e instanceof Error ? e.message : 'Demo payment failed'); }
    finally { setBusy(''); }
  }

  if (!session) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return (
    <main className="billing-page">
      <header className="management-header billing-header">
        <a className="management-back" href="/"><ArrowLeft size={17}/> Back to chat</a>
        <div className="brand"><Image src="/uvms-logo.png" width={36} height={36} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>PLANS</b></div>
        <div className="billing-secure"><ShieldCheck size={15}/> Shared subscription</div>
      </header>

      <section className="billing-shell">
        <div className="billing-hero">
          <div className="beta-badge">UVMS AI · BILLING FOUNDATION</div>
          <h1>One plan. <span>Every device.</span></h1>
          <p>Upgrade once and the same entitlement is used by Web and Mobile through your UVMS account.</p>
          {subscription && <div className="current-plan"><Check size={16}/><span>Current plan</span><strong>{subscription.plan_name}</strong><small>{subscription.status}</small></div>}
        </div>

        {error && <div className="error-box billing-message">{error}</div>}
        {notice && <div className="success-box billing-message"><Check size={15}/>{notice}</div>}

        <div className="billing-plan-grid">
          {plans.map(plan => {
            const current = plan.code === subscription?.plan_code;
            const featured = plan.code === 'plus';
            return <article key={plan.code} className={`billing-plan ${featured ? 'featured' : ''} ${current ? 'current' : ''}`}>
              <div className="billing-plan-icon">{plan.code === 'pro' ? <Zap/> : plan.code === 'plus' ? <Sparkles/> : <ShieldCheck/>}</div>
              <small>{plan.code.toUpperCase()}</small>
              <h2>{plan.name}</h2>
              <div className="billing-price"><strong>{plan.monthly_price_cents === 0 ? 'Free' : money(plan.monthly_price_cents, plan.currency)}</strong>{plan.monthly_price_cents > 0 && <span>/ month</span>}</div>
              <ul>
                <li><Check/> {plan.limits.messages_daily ?? '—'} messages / day</li>
                <li><Check/> {plan.limits.web_search_daily ?? '—'} web searches / day</li>
                <li><Check/> {plan.limits.images_monthly ?? '—'} images / month</li>
                <li><Check/> {plan.limits.storage_mb ?? '—'} MB storage</li>
                <li><Check/> max {plan.limits.max_file_mb ?? '—'} MB / file</li>
              </ul>
              <button disabled={current || plan.code === 'free' || !billingEnabled || busy === plan.code} onClick={() => startCheckout(plan)}>
                {current ? 'Current plan' : plan.code === 'free' ? 'Included' : !billingEnabled ? 'Coming soon' : busy === plan.code ? 'Creating checkout…' : `Choose ${plan.name}`}
              </button>
            </article>;
          })}
        </div>

        {checkout && <section className="checkout-panel">
          <div className="checkout-icon"><CreditCard size={23}/></div>
          <div><small>CHECKOUT SESSION</small><h3>{checkout.plan_code.toUpperCase()} · {money(checkout.amount_cents, checkout.currency)}</h3><p>Provider: {checkout.provider} · Status: {checkout.status}</p></div>
          {checkout.provider === 'demo' && checkout.status === 'pending' && <button onClick={completeDemo} disabled={busy === 'demo'}>{busy === 'demo' ? 'Processing…' : 'Complete demo payment'}</button>}
          {checkout.status === 'completed' && <div className="checkout-complete"><Check size={17}/> Activated</div>}
        </section>}

        <p className="billing-footnote">{billingProvider === 'demo' ? 'Live payments are not available in this beta. Demo checkout charges no money.' : billingEnabled ? 'Plan changes are processed by the configured billing provider.' : 'Paid subscriptions are currently disabled on this deployment. Your existing plan remains active.'}</p>
      </section>
    </main>
  );
}
