import Script from 'next/script';

/** Google Ads tag (gtag.js) for riskmodels.app — conversion / remarketing base tag */
const GOOGLE_ADS_GTAG_ID = 'AW-18161098219';

export function GoogleAdsTag() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_GTAG_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-ads-gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GOOGLE_ADS_GTAG_ID}');
        `}
      </Script>
    </>
  );
}
