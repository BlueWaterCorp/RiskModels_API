import { GA4_MEASUREMENT_ID, GOOGLE_ADS_GTAG_ID } from '@/lib/google-tags';

/** Google tag (gtag.js): GA4 + Ads on riskmodels.app — last in <head> before </head>.
 *  Load the (universal) gtag.js runtime via the Ads ID, which is guaranteed to be
 *  provisioned; a brand-new GA4 measurement ID can 404 on the loader for a while
 *  after stream creation, which would block the whole runtime. Both destinations
 *  are then activated via config() below. */
export function GoogleAdsTag() {
  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_GTAG_ID}`}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA4_MEASUREMENT_ID}');
          gtag('config', '${GOOGLE_ADS_GTAG_ID}');
        `,
        }}
      />
    </>
  );
}
