// Central tuning values. Units: metres, seconds, radians.
export const CONFIG = {
  track: {
    cell: 160,          // grid cell size – every tile fits a whole number of cells
    width: 28,          // drivable width between walls
    wallHeight: 2.2,
    sampleStep: 1,      // spacing of resampled centerline points
    rampHeight: 18,     // elevation change of one ramp tile
    groundY: -1.0,     // street level (the road sits on a low hull above it)
  },
  car: {
    length: 5.0,        // the model is scaled so its length matches this
    hover: 0.75,
    halfWidth: 1.3,
    thrust: 42,
    dragLin: 0.04,
    dragQuad: 0.0023,   // -> top speed ~125 m/s (~450 km/h)
    brake: 45,
    steerRateLow: 2.0,  // yaw rad/s at low speed
    steerRateHigh: 1.3, // yaw rad/s at top speed
    airbrakeYaw: 0.7,
    airbrakeDrag: 0.010,
    grip: 2.8,          // how fast velocity re-aligns with heading
    airbrakeGrip: 5.5,
    boostAccel: 70,
    boostTime: 1.5,
    boostMaxExtra: 45,  // boost raises effective top speed by this much
    slopeGravity: 0.55,
  },
  race: {
    laps: 3,
    opponents: 5,
  },
};

export const KMH = 3.6;
