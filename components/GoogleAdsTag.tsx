import { GA4_MEASUREMENT_ID, GOOGLE_ADS_GTAG_ID } from '@/lib/google-tags';

/** Google tag (gtag.js): GA4 + Ads on riskmodels.app — last in <head> before </head>. */
export function GoogleAdsTag() {
  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`}
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
