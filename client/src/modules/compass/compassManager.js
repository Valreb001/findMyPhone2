/**
 * client/src/modules/compass/compassManager.js
 * Handles device orientation, heading smoothing,
 * permissions, cleanup, and cardinal directions.
 */

class CompassManager {
  constructor() {
    this.currentHeading = 0;
    this.currentAccuracy = null;

    this.isListening = false;
    this.listeners = [];

    // Smoothing factor (0-1)
    this.smoothingFactor = 0.2;

    // Store bound handler once
    this.boundOrientationHandler =
      this.handleDeviceOrientation.bind(this);
  }

  /**
   * Request orientation permission
   * Required for iOS 13+
   */
  async requestPermission() {
    if (!this.hasDeviceOrientation()) {
      return false;
    }

    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const permission =
          await DeviceOrientationEvent.requestPermission();

        console.log(
          `[COMPASS] Permission: ${permission}`
        );

        return permission === 'granted';
      } catch (error) {
        console.error(
          '[COMPASS] Permission request failed:',
          error
        );

        return false;
      }
    }

    return true;
  }

  /**
   * Check support
   */
  hasDeviceOrientation() {
    return (
      typeof window !== 'undefined' &&
      'DeviceOrientationEvent' in window
    );
  }

  /**
   * Start listening
   */
  startListening() {
    if (this.isListening) {
      return true;
    }

    if (!this.hasDeviceOrientation()) {
      console.warn(
        '[COMPASS] Device orientation not supported'
      );
      return false;
    }

    window.addEventListener(
      'deviceorientation',
      this.boundOrientationHandler
    );

    this.isListening = true;

    console.log(
      '[COMPASS] Orientation listener started'
    );

    return true;
  }

  /**
   * Stop listening
   */
  stopListening() {
    if (!this.isListening) return;

    window.removeEventListener(
      'deviceorientation',
      this.boundOrientationHandler
    );

    this.isListening = false;

    console.log(
      '[COMPASS] Orientation listener stopped'
    );
  }

  /**
   * Handle orientation updates
   */
  handleDeviceOrientation(event) {
    if (event.alpha == null) {
      return;
    }

    const rawHeading = event.alpha;

    // Smooth noisy compass readings
    const smoothedHeading =
      this.currentHeading +
      (rawHeading - this.currentHeading) *
        this.smoothingFactor;

    const heading =
      (smoothedHeading + 360) % 360;

    const accuracy =
      event.webkitCompassAccuracy ?? null;

    this.currentHeading = heading;
    this.currentAccuracy = accuracy;

    const payload = {
      heading: Math.round(heading),
      accuracy,
      direction: this.getCardinalDirection(
        heading
      ),
      beta: event.beta,
      gamma: event.gamma,
    };

    this.listeners.forEach((callback) =>
      callback(payload)
    );
  }

  /**
   * Convert heading to
   * N, NE, E, SE, S, SW, W, NW
   */
  getCardinalDirection(heading) {
    const directions = [
      'N',
      'NE',
      'E',
      'SE',
      'S',
      'SW',
      'W',
      'NW',
    ];

    const index =
      Math.round(heading / 45) % 8;

    return directions[index];
  }

  /**
   * Subscribe
   */
  onHeadingChange(callback) {
    this.listeners.push(callback);

    return () => {
      this.listeners =
        this.listeners.filter(
          (cb) => cb !== callback
        );
    };
  }

  /**
   * Current heading
   */
  getHeading() {
    return Math.round(
      this.currentHeading
    );
  }

  /**
   * Current accuracy
   */
  getAccuracy() {
    return this.currentAccuracy;
  }

  /**
   * Current direction
   */
  getDirection() {
    return this.getCardinalDirection(
      this.currentHeading
    );
  }

  /**
   * Cleanup everything
   */
  destroy() {
    this.stopListening();

    this.listeners = [];

    this.currentHeading = 0;
    this.currentAccuracy = null;

    console.log(
      '[COMPASS] Destroyed'
    );
  }
}

export const compassManager =
  new CompassManager();

// /**
//  * client/src/modules/compass/compassManager.js
//  * Handle device orientation and compass heading
//  */

// class CompassManager {
//   constructor() {
//     this.currentHeading = 0;
//     this.currentAccuracy = null;
//     this.isListening = false;
//     this.listeners = [];
//   }

//   /**
//    * Request permission for device orientation (iOS 13+)
//    */
//   async requestPermission() {
//     if (!this.hasDeviceOrientation()) {
//       return false;
//     }

//     // iOS 13+ requires explicit permission
//     if (
//       typeof DeviceOrientationEvent !== 'undefined' &&
//       typeof DeviceOrientationEvent.requestPermission === 'function'
//     ) {
//       try {
//         const permission = await DeviceOrientationEvent.requestPermission();
//         console.log(`[COMPASS] Permission: ${permission}`);
//         return permission === 'granted';
//       } catch (error) {
//         console.error('[COMPASS] Permission denied:', error);
//         return false;
//       }
//     }

//     // Non-iOS or older iOS
//     return true;
//   }

//   /**
//    * Check if device orientation is supported
//    */
//   hasDeviceOrientation() {
//     return window.DeviceOrientationEvent !== undefined;
//   }

//   /**
//    * Start listening for device orientation
//    */
//   startListening() {
//     if (this.isListening) return;

//     if (!this.hasDeviceOrientation()) {
//       console.warn('[COMPASS] Device orientation not supported');
//       return false;
//     }

//     window.addEventListener('deviceorientation', this.handleDeviceOrientation.bind(this));
//     this.isListening = true;

//     console.log('[COMPASS] Listening started');
//     return true;
//   }

//   /**
//    * Stop listening
//    */
//   stopListening() {
//     window.removeEventListener('deviceorientation', this.handleDeviceOrientation.bind(this));
//     this.isListening = false;
//     console.log('[COMPASS] Listening stopped');
//   }

//   /**
//    * Handle device orientation event
//    */
//   handleDeviceOrientation(event) {
//     // event.alpha: Z axis rotation (0-360) - compass bearing
//     // event.beta: X axis rotation (-180 to 180)
//     // event.gamma: Y axis rotation (-90 to 90)

//     const heading = Math.round(event.alpha);
//     const accuracy = event.webkitCompassAccuracy || null; // Some phones provide this

//     this.currentHeading = heading;
//     this.currentAccuracy = accuracy;

//     // Notify listeners
//     this.listeners.forEach((callback) => {
//       callback({
//         heading,
//         accuracy,
//         beta: event.beta,
//         gamma: event.gamma,
//       });
//     });
//   }

//   /**
//    * Subscribe to heading changes
//    */
//   onHeadingChange(callback) {
//     this.listeners.push(callback);

//     return () => {
//       this.listeners = this.listeners.filter((cb) => cb !== callback);
//     };
//   }

//   /**
//    * Get current heading
//    */
//   getHeading() {
//     return this.currentHeading;
//   }

//   /**
//    * Get current accuracy
//    */
//   getAccuracy() {
//     return this.currentAccuracy;
//   }
// }

// export const compassManager = new CompassManager();

