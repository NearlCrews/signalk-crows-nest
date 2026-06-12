/**
 * SignalK `vessels.self` data-model paths read by more than one module. The
 * position path is subscribed by the position monitor and read synchronously
 * by the course reader; defining each path once keeps the consumers from
 * drifting.
 */

/** The vessel position path. */
export const SELF_POSITION_PATH = 'navigation.position'

/** The speed-over-ground path the course reader uses for ETA math. */
export const SELF_SOG_PATH = 'navigation.speedOverGround'
