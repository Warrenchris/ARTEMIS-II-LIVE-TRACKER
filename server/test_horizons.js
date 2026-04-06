const axios = require('axios');

async function run() {
  const now   = new Date();
  const start = new Date(now.getTime() - 60_000);  // -1 min
  const stop  = new Date(now.getTime() + 60_000);  // +1 min

  const params = {
    format:     'json',
    COMMAND:    '-1024',
    OBJ_DATA:   'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER:     '500@399',
    START_TIME: start.toISOString(),
    STOP_TIME:  stop.toISOString(),
    STEP_SIZE:  '1m',
    OUT_UNITS:  'KM-S',
    REF_PLANE:  'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    VECT_CORR:  'NONE',
    VEC_LABELS: 'NO',
    CSV_FORMAT: 'YES',
  };

  try {
    const response = await axios.get('https://ssd.jpl.nasa.gov/api/horizons.api', { params });
    console.log("Success length:", JSON.stringify(response.data).length);
  } catch (err) {
    if (err.response) {
      console.log("400 URL output:", err.request.res.responseUrl);
      console.error("400 Error Body:", err.response.data);
    } else {
      console.error("Error:", err.message);
    }
  }
}
run();
