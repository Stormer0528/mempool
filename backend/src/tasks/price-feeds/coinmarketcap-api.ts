import config from '../../config';
import logger from '../../logger';
import PricesRepository from '../../repositories/PricesRepository';
import { query } from '../../utils/axios-query';
import priceUpdater, { PriceFeed, PriceHistory } from '../price-updater';

class CoinmarketcapApi implements PriceFeed {
  public name: string = 'Kraken';
  public currencies: string[] = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'];

  public url: string = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?CMC_PRO_API_KEY=${config.MEMPOOL.COIN_MARKET_CAP_PRO_KEY}&id=32744&convert=`;
  public urlHist: string = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/historical?CMC_PRO_API_KEY=${config.MEMPOOL.COIN_MARKET_CAP_PRO_KEY}&id=32744&interval={GRANULARITY}&convert=`;

  constructor() {
  }

  public async $fetchPrice(currency): Promise<number> {
    const response = await query(this.url + currency);

    if (response && response['data'] && response['data']['32744'] &&
      response['data']['32744']['quote'] && response['data']['32744']['quote'][currency]
    ) {
      return response['data']['32744']['quote'][currency].price;
    } else {
      return -1;
    }
  }

  public async $fetchRecentPrice(currencies: string[], type: 'hour' | 'day'): Promise<PriceHistory> {
    const priceHistory: PriceHistory = {};

    for (const currency of currencies) {
      if (this.currencies.includes(currency) === false) {
        continue;
      }

      const response = await query(this.urlHist.replace('{GRANULARITY}', '1h') + currency);
      const pricesRaw = response ? response['data']['quotes'] : [];
      for (const price of pricesRaw) {
        const unixTimestamp = Math.floor(new Date(price.timestamp).getTime() / 1000);
        if (priceHistory[unixTimestamp] === undefined) {
          priceHistory[unixTimestamp] = priceUpdater.getEmptyPricesObj();
        }
        priceHistory[unixTimestamp][currency] = price.quote[currency].price;
      }
    }

    return priceHistory;
  }

  /**
   * Fetch weekly price and save it into the database
   */
  public async $insertHistoricalPrice(): Promise<void> {
    const existingPriceTimes = await PricesRepository.$getPricesTimes();

    // EUR weekly price history goes back to timestamp 1378339200 (September 5, 2013)
    // USD weekly price history goes back to timestamp 1380758400 (October 3, 2013)
    // GBP weekly price history goes back to timestamp 1415232000 (November 6, 2014)
    // JPY weekly price history goes back to timestamp 1415232000 (November 6, 2014)
    // CAD weekly price history goes back to timestamp 1436400000 (July 9, 2015)
    // CHF weekly price history goes back to timestamp 1575504000 (December 5, 2019)
    // AUD weekly price history goes back to timestamp 1591833600 (June 11, 2020)

    let priceHistory: any = {}; // map: timestamp -> Prices

    for (const currency of this.currencies) {
      const response = await query(this.urlHist.replace('{GRANULARITY}', '7d') + currency);

      const priceHistoryRaw = response ? response['data']['quotes'] : [];

      for (const price of priceHistoryRaw) {
        // Convert price.timestamp to unix timestamp (seconds)
        const unixTimestamp = Math.floor(new Date(price.timestamp).getTime() / 1000);
        if (existingPriceTimes.includes(unixTimestamp)) {
          continue;
        }

        // prices[0] = kraken price timestamp
        // prices[4] = closing price
        if (priceHistory[unixTimestamp] === undefined) {
          priceHistory[unixTimestamp] = priceUpdater.getEmptyPricesObj();
        }
        priceHistory[unixTimestamp][currency] = price.quote[currency].price;
      }
    }

    for (const time in priceHistory) {
      if (priceHistory[time].USD === -1) {
        delete priceHistory[time];
        continue;
      }
      await PricesRepository.$savePrices(parseInt(time, 10), priceHistory[time]);
    }

    if (Object.keys(priceHistory).length > 0) {
      logger.info(`Inserted ${Object.keys(priceHistory).length} Kraken EUR, USD, GBP, JPY, CAD, CHF and AUD weekly price history into db`, logger.tags.mining);
    }
  }
}

export default CoinmarketcapApi;
