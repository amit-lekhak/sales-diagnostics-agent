import 'dotenv/config';
import { closeWeatherSql, runWeatherSync } from '../src/lib/weather/openweather';

runWeatherSync()
  .then(async () => {
    await closeWeatherSql();
  })
  .catch(async (err) => {
    console.error(err);
    await closeWeatherSql();
    process.exit(1);
  });
