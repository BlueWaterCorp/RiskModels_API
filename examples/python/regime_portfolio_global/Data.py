import pandas as pd
import xarray as xr

def get_tickers(tickers=None):
    mapping = pd.read_csv("Mapping.csv")
    ds = xr.open_zarr("gs://rm_api_public/eodhd/ds_synth_factors.zarr",
                  storage_options={"token": "anon"}, consolidated=True)
    ret = ds['return'].to_pandas()
    ss_available = set(ret.columns)
    if tickers is None:
        tickers = mapping.loc[mapping['recommended_ffx'].isin(ss_available), 'ticker'].tolist()
    return tickers

def get_price_data(tickers,years, client): 
    data = []
    missing = []
    for t in tickers:
        try:
            df = client.get_ticker_returns(t, years=years)[['date', 'returns_gross']].copy()
            df['ticker'] = t
            data.append(df)
        except Exception as e:
            
            missing.append(t)
            continue
    if not data:
        raise ValueError("No ticker data retrieved — all requests failed.")
    data = pd.concat(data, ignore_index = True)
    return data, missing



def add_sector_subsector(df, client, level='L3', verbose=True):
    tickers = df['ticker'].unique()
    sec, sub, failed = {}, {}, []
    for i, t in enumerate(tickers, 1):
        try:
            m = client.get_metrics(t, as_dataframe=True)
            if m.empty:
                failed.append(t); continue
            hl = m['hedge_levels'].iloc[-1] or {}
            etfs = (hl.get(level) or {}).get('hedge_etfs') or {}
            sec[t] = etfs.get('sector')
            sub[t] = etfs.get('subsector')
        except Exception as e:
            failed.append(t)
            if verbose:
                print(f"[{i}/{len(tickers)}] {t}: failed ({e!r})")
        

    df = df.copy()
    df['sector']    = ('FFX_' + df['ticker'].map(sec)).where(df['ticker'].map(sec).notna())
    mp = pd.read_csv('mapping.csv').drop_duplicates('ticker').set_index('ticker')['recommended_ffx']
    df['subsector'] = df['ticker'].map(mp)
    return df, sec, sub, failed

def get_subsector_sector_data(df):
    ds = xr.open_zarr("gs://rm_api_public/eodhd/ds_synth_factors.zarr",
                  storage_options={"token": "anon"}, consolidated=True)
    ret = ds['return'].to_pandas()
    ret.index = pd.to_datetime(ret.index)
    long = ret.stack().rename('r')                     

    df['date'] = pd.to_datetime(df['date'])
    sec_key = df['sector']
    df['sector_ret']    = long.reindex(pd.MultiIndex.from_arrays([df['date'], sec_key])).values
    df['subsector_ret'] = long.reindex(pd.MultiIndex.from_arrays([df['date'], df['subsector']])).values
    return df

import numpy as np
def get_data(tickers, client, method, resample_window):
    if tickers is None:
        tickers = get_tickers()
    data, missing = get_price_data(tickers, years=26, client=client)
    data = data.dropna(subset=['returns_gross']).reset_index(drop=True)

    import pandas_datareader.data as web
    ff = web.DataReader('F-F_Research_Data_5_Factors_2x3_daily', 'famafrench',
                        start='2000-01-01')[0] / 100
    ff.index = pd.to_datetime(ff.index)

    spy = client.get_ticker_returns('SPY', years=26)[['date', 'returns_gross']]
    spy['date'] = pd.to_datetime(spy['date'])
    spy_d = spy.set_index('date')['returns_gross']

    def _resid(y, X):
        X = np.column_stack([np.ones(len(X)), X])
        return y - X @ np.linalg.lstsq(X, y, rcond=None)[0]

    def _orth(w):
        w = w.dropna(subset=['sector']).reset_index(drop=True)
        z = w[['sector_ret', 'subsector_ret', 'size', 'growth']].eq(0).all(axis=1)
        w = w[~z].reset_index(drop=True)
        w['stock_ret']    = w['returns_gross']
        m = w['market_ret'].values
        w['sector_o']     = _resid(w['sector_ret'].values,    m[:, None])
        w['subsector_o']  = _resid(w['subsector_ret'].values, w[['market_ret', 'sector_o']].values)
        w['growth_o']     = _resid(w['growth'].values,        w[['market_ret', 'sector_o', 'subsector_o']].values)
        w['size_o']       = _resid(w['size'].values,          w[['market_ret', 'sector_o', 'subsector_o', 'growth_o']].values)
        return w

    if method == 1:
        df, sec, sub, failed = add_sector_subsector(data, client)
        df = get_subsector_sector_data(df)
        df['date'] = pd.to_datetime(df['date'])
        df['size']       = df['date'].map(ff['SMB'])
        df['growth']     = df['date'].map(-ff['HML'])
        df['market_ret'] = df['date'].map(spy_d)

        if resample_window == 'W':
            ret_cols = ['returns_gross', 'sector_ret', 'subsector_ret', 'size', 'growth', 'market_ret']
            weekly = (df.set_index('date').groupby('ticker')[ret_cols]
                        .resample('W-SUN').apply(lambda x: (1 + x).prod() - 1).reset_index())
            lbl = df.drop_duplicates('ticker').set_index('ticker')[['sector', 'subsector']]
            weekly = weekly.join(lbl, on='ticker')
            return _orth(weekly)
        return _orth(df)

    elif method == 2:
        df = data.copy()
        df['date'] = pd.to_datetime(df['date'])
        for c in ['Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA']:
            df[c] = df['date'].map(ff[c])
        df['market_ret'] = df['date'].map(spy_d)

        if resample_window == 'W':
            ret_cols = ['returns_gross', 'Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA', 'market_ret']
            weekly = (df.set_index('date').groupby('ticker')[ret_cols]
                        .resample('W-SUN').apply(lambda x: (1 + x).prod() - 1).reset_index())
            return weekly
        return df
