import posthog from 'posthog-js';

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export function initPostHog() {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2026-05-30',
      person_profiles: 'identified_only',
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') {
          ph.debug();
        }
      },
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: true,
    });
  }
}

export function identifyUser(userId: string, properties: Record<string, unknown>) {
  if (typeof window !== 'undefined') {
    posthog.identify(userId, properties);
  }
}

export function trackEvent(eventName: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined') {
    posthog.capture(eventName, properties);
  }
}

export function trackPageView(pageName?: string) {
  if (typeof window !== 'undefined') {
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      page_name: pageName,
      site: 'riskmodels.app',
    });
  }
}

export function resetUser() {
  if (typeof window !== 'undefined') {
    posthog.reset();
  }
}

/** GTM funnel diagnostics for riskmodels.app */
export const gtmAnalytics = {
  signupFormViewed: (source?: string) =>
    trackEvent('signup_form_viewed', { source, site: 'riskmodels.app' }),
  signupFormSubmitted: (email?: string) => {
    const emailDomain = email?.includes('@') ? email.split('@')[1] : undefined;
    trackEvent('signup_form_submitted', { email_domain: emailDomain, site: 'riskmodels.app' });
  },
  signupError: (errorMessage: string) =>
    trackEvent('signup_error_encountered', { error_message: errorMessage, site: 'riskmodels.app' }),
  signupSuccess: (method?: string) =>
    trackEvent('signup_successful', { method, site: 'riskmodels.app' }),

  ctaClicked: (buttonText: string, location: string) =>
    trackEvent('cta_clicked', {
      button_text: buttonText,
      location,
      page: typeof window !== 'undefined' ? window.location.pathname : undefined,
      site: 'riskmodels.app',
    }),

  apiKeyCreated: () => trackEvent('api_key_created', { site: 'riskmodels.app' }),
  apiKeyCopied: (keyPrefix?: string) =>
    trackEvent('api_key_copied', { key_prefix: keyPrefix?.slice(0, 8), site: 'riskmodels.app' }),
  apiKeyRevoked: () => trackEvent('api_key_revoked', { site: 'riskmodels.app' }),

  apiDocsPageViewed: (section?: string) =>
    trackEvent('api_docs_page_viewed', { section, site: 'riskmodels.app' }),
  apiEndpointExpanded: (endpoint: string, method?: string) =>
    trackEvent('api_endpoint_expanded', { endpoint, method, site: 'riskmodels.app' }),
  apiExampleCopied: (endpoint: string) =>
    trackEvent('api_example_copied', { endpoint, site: 'riskmodels.app' }),
  tryApiClicked: (endpoint: string) =>
    trackEvent('try_api_clicked', { endpoint, site: 'riskmodels.app' }),
};

export default posthog;
