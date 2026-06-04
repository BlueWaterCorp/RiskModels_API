/** Google Ads tag (gtag.js) for riskmodels.app — paste before closing </head> */
const GOOGLE_ADS_GTAG_ID = 'AW-18161098219';

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
          gtag('config', '${GOOGLE_ADS_GTAG_ID}');
        `,
        }}
      />
    </>
  );
}
