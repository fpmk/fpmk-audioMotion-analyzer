/**!
 * audioMotion-analyzer
 * High-resolution real-time graphic audio spectrum analyzer JS module
 *
 * @version 3.0.0-alpha
 * @author  Henrique Avila Vianna <hvianna@gmail.com> <https://henriquevianna.com>
 * @license AGPL-3.0-or-later
 */

const _VERSION = '3.0.0-alpha.1';

export default class AudioMotionAnalyzer {

/**
 * CONSTRUCTOR
 *
 * @param {object} [container] DOM element where to insert the analyzer; if undefined, uses the document body
 * @param {object} [options]
 * @returns {object} AudioMotionAnalyzer object
 */
	constructor( container, options = {} ) {

		this._initDone = false;

		// Gradient definitions

		this._gradients = {
			classic: {
				bgColor: '#111',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					{ pos: .6, color: 'hsl( 60, 100%, 50% )' },
					'hsl( 120, 100%, 50% )'
				]
			},
			prism:   {
				bgColor: '#111',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					'hsl( 60, 100%, 50% )',
					'hsl( 120, 100%, 50% )',
					'hsl( 180, 100%, 50% )',
					'hsl( 240, 100%, 50% )'
				]
			},
			rainbow: {
				bgColor: '#111',
				dir: 'h',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					'hsl( 60, 100%, 50% )',
					'hsl( 120, 100%, 50% )',
					'hsl( 180, 100%, 47% )',
					'hsl( 240, 100%, 58% )',
					'hsl( 300, 100%, 50% )',
					'hsl( 360, 100%, 50% )'
				]
			},
		};

		// Set container
		this._container = container || document.body;

		// Make sure we have minimal width and height dimensions in case of an inline container
		this._defaultWidth  = this._container.clientWidth  || 640;
		this._defaultHeight = this._container.clientHeight || 270;

		// Use audio context provided by user, or create a new one

		const AudioContext = window.AudioContext || window.webkitAudioContext;

		if ( options.hasOwnProperty( 'audioCtx' ) ) {
			if ( options.audioCtx instanceof AudioContext )
				this._audioCtx = options.audioCtx;
			else
				throw new AudioMotionError( 'ERR_INVALID_AUDIO_CONTEXT', 'Provided audio context is not valid' );
		}
		else {
			try {
				this._audioCtx = new AudioContext();
			}
			catch( err ) {
				throw new AudioMotionError( 'ERR_AUDIO_CONTEXT_FAIL', 'Could not create audio context. Web Audio API not supported?' );
			}
		}

		/*
			Connection routing:
			===================

			for STEREO:                              +--->  analyzer[0]  ---+
		    	                                     |                      |
			(source) --->  input  --->  splitter  ---+                      +--->  merger  --->  output  ---> (destination)
		    	             |                       |                      |                       |
		        	         |                       +--->  analyzer[1]  ---+                       |
			                 |                                                                      |
			for MONO:        |                                                                      |
			                 |                                                                      |
			(source) --->  input  ----------------------->  analyzer[0]  --------------------->  output  ---> (destination)
		    	             |                                                                      |
			                 |                                                                      |
			                 |                                                                      |
			                 +------------------------> (interface objects) <-----------------------+
		*/

		// create the analyzer nodes, channel splitter and merger, and gain node
		this._analyzer = [ this._audioCtx.createAnalyser(), this._audioCtx.createAnalyser() ];
		this._splitter = this._audioCtx.createChannelSplitter(2);
 		this._merger   = this._audioCtx.createChannelMerger(2);
 		this._input    = this._audioCtx.createGain();
 		this._output   = this._audioCtx.createGain();

 		// connect splitter -> analyzers -> merger
		for ( let i = 0; i < 2; i++ )
			this._splitter.connect( this._analyzer[ i ], i ).connect( this._merger, 0, i );

 		// connect audio source, if provided in the options
		this._audioSource = options.source ? this.connectAudio( options.source ) : undefined;

		// connect merger -> output -> destination (speakers)
		this._merger.connect( this._output ).connect( this._audioCtx.destination );

		// initialize object to save instant and peak energy
		this._energy = { instant: 0, peak: 0, hold: 0 };

		// create analyzer canvas
		this._canvas = document.createElement('canvas');
		this._canvas.style = 'max-width: 100%;';
		this._container.appendChild( this._canvas );
		this._canvasCtx = this._canvas.getContext('2d');

		// create auxiliary canvases for the X-axis and circular scale labels
		this._labels = document.createElement('canvas');
		this._labelsCtx = this._labels.getContext('2d');
		this._circScale = document.createElement('canvas');
		this._circScaleCtx = this._circScale.getContext('2d');

		// Update canvas size on container / window resize and fullscreen events

		// Fullscreen changes are handled quite differently across browsers:
		// 1. Chromium browsers will trigger a `resize` event followed by a `fullscreenchange`
		// 2. Firefox triggers the `fullscreenchange` first and then the `resize`
		// 3. Chrome on Android (TV) won't trigger a `resize` event, only `fullscreenchange`
		// 4. Safari won't trigger `fullscreenchange` events at all, and on iPadOS the `resize`
		//    event is triggered **on the window** only (last tested on iPadOS 14)

		// helper function for resize events
		const onResize = () => {
			if ( ! this._fsTimeout ) {
				// delay the resize to prioritize a possible following `fullscreenchange` event
				this._fsTimeout = window.setTimeout( () => {
					if ( ! this._fsChanging ) {
						this._setCanvas('resize');
						this._fsTimeout = 0;
					}
				}, 60 );
			}
		}

		// if browser supports ResizeObserver, listen for resize on the container
		if ( window.ResizeObserver ) {
			const resizeObserver = new ResizeObserver( onResize );
			resizeObserver.observe( this._container );
		}

		// listen for resize events on the window - required for fullscreen on iPadOS
		window.addEventListener( 'resize', onResize );

		// listen for fullscreenchange events on the canvas - not available on Safari
		this._canvas.addEventListener( 'fullscreenchange', () => {
			// set flag to indicate a fullscreen change in progress
			this._fsChanging = true;

			// if there is a scheduled resize event, clear it
			if ( this._fsTimeout )
				window.clearTimeout( this._fsTimeout );

			// update the canvas
			this._setCanvas('fschange');

			// delay clearing the flag to prevent any shortly following resize event
			this._fsTimeout = window.setTimeout( () => {
				this._fsChanging = false;
				this._fsTimeout = 0;
			}, 60 );
		});

		// initialize internal variables
		this._calculateInternals();

		// Set configuration options and use defaults for any missing properties
		this._setProperties( options, true );

		// Finish canvas setup
		this._initDone = true;
		this._setCanvas('create');
	}

	/**
	 * ==========================================================================
	 *
	 * PUBLIC PROPERTIES GETTERS AND SETTERS
	 *
	 * ==========================================================================
	 */

	// Bar spacing (for octave bands modes)

	get barSpace() {
		return this._barSpace;
	}
	set barSpace( value ) {
		this._barSpace = Number( value ) || 0;
		this._calculateInternals();
	}

	// FFT size

	get fftSize() {
		return this._analyzer[0].fftSize;
	}
	set fftSize( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].fftSize = value;
		this._dataArray = new Uint8Array( this._analyzer[0].frequencyBinCount );
		this._precalculateBarPositions();
	}

	// Gradient

	get gradient() {
		return this._gradient;
	}
	set gradient( value ) {
		if ( this._gradients.hasOwnProperty( value ) )
			this._gradient = value;
		else
			throw new AudioMotionError( 'ERR_UNKNOWN_GRADIENT', `Unknown gradient: '${value}'` );
	}

	// Canvas size

	get height() {
		return this._height;
	}
	set height( h ) {
		this._height = h;
		this._setCanvas('user');
	}
	get width() {
		return this._width;
	}
	set width( w ) {
		this._width = w;
		this._setCanvas('user');
	}

	// Visualization mode

	get mode() {
		return this._mode;
	}
	set mode( value ) {
		const mode = value | 0;
		if ( mode >= 0 && mode <= 10 && mode != 9 ) {
			this._mode = mode;
			this._calculateInternals();
			this._precalculateBarPositions();
			if ( this._reflexRatio > 0 )
				this._generateGradients();
		}
		else
			throw new AudioMotionError( 'ERR_INVALID_MODE', `Invalid mode: ${value}` );
	}

	// Low-resolution mode

	get loRes() {
		return this._loRes;
	}
	set loRes( value ) {
		this._loRes = !! value;
		this._setCanvas('lores');
	}

	// Luminance bars

	get lumiBars() {
		return this._lumiBars;
	}
	set lumiBars( value ) {
		this._lumiBars = !! value;
		this._calculateInternals();
		if ( this._reflexRatio > 0 ) {
			this._generateGradients();
			this._calculateLedProperties();
		}
	}

	// Radial mode

	get radial() {
		return this._radial;
	}
	set radial( value ) {
		this._radial = !! value;
		this._calculateInternals();
		this._calculateLedProperties();
		this._generateGradients();
	}

	// Radial spin speed

	get spinSpeed() {
		return this._spinSpeed;
	}
	set spinSpeed( value ) {
		value = Number( value ) || 0;
		if ( this._spinSpeed === undefined || value == 0 )
			this._spinAngle = -Math.PI / 2; // initialize or reset the rotation angle
		this._spinSpeed = value;
	}

	// Reflex

	get reflexRatio() {
		return this._reflexRatio;
	}
	set reflexRatio( value ) {
		value = Number( value ) || 0;
		if ( value < 0 || value >= 1 )
			throw new AudioMotionError( 'ERR_REFLEX_OUT_OF_RANGE', `Reflex ratio must be >= 0 and < 1` );
		else {
			this._reflexRatio = value;
			this._generateGradients();
			this._calculateLedProperties();
		}
	}

	// Current frequency range

	get minFreq() {
		return this._minFreq;
	}
	set minFreq( value ) {
		if ( value < 1 )
			throw new AudioMotionError( 'ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1` );
		else {
			this._minFreq = value;
			this._precalculateBarPositions();
		}
	}
	get maxFreq() {
		return this._maxFreq;
	}
	set maxFreq( value ) {
		if ( value < 1 )
			throw new AudioMotionError( 'ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1` );
		else {
			this._maxFreq = value;
			this._precalculateBarPositions();
		}
	}

	// Analyzer's sensitivity

	get minDecibels() {
		return this._analyzer[0].minDecibels;
	}
	set minDecibels( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].minDecibels = value;
	}
	get maxDecibels() {
		return this._analyzer[0].maxDecibels;
	}
	set maxDecibels( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].maxDecibels = value;
	}

	// LEDs effect

	get showLeds() {
		return this._showLeds;
	}
	set showLeds( value ) {
		this._showLeds = !! value;
		this._calculateInternals();
	}

	// Analyzer's smoothing time constant

	get smoothing() {
		return this._analyzer[0].smoothingTimeConstant;
	}
	set smoothing( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].smoothingTimeConstant = value;
	}

	// Split gradient (in stereo mode)

	get splitGradient() {
		return this._splitGradient;
	}
	set splitGradient( value ) {
		this._splitGradient = !! value;
		this._generateGradients();
	}

	// Stereo

	get stereo() {
		return this._stereo;
	}
	set stereo( value ) {
		this._stereo = !! value;

		// update node connections
		this._input.disconnect();
		this._analyzer[0].disconnect();
		this._input.connect( this._stereo ? this._splitter : this._analyzer[0] );
		this._analyzer[0].connect( this._stereo ? this._merger : this._output );

		// update properties affected by stereo
		this._calculateInternals();
		this._generateScaleX();
		this._calculateLedProperties();
		this._generateGradients();
	}

	// Read only properties

	get audioCtx() {
		return this._audioCtx;
	}
	get audioSource() {
		return this._audioSource;
	}
	get canvas() {
		return this._canvas;
	}
	get canvasCtx() {
		return this._canvasCtx;
	}
	get energy() {
		return this._energy.instant;
	}
	get fsWidth() {
		return this._fsWidth;
	}
	get fsHeight() {
		return this._fsHeight;
	}
	get fps() {
		return this._fps;
	}
	get input() {
		return this._input;
	}
	get isFullscreen() {
		return ( document.fullscreenElement || document.webkitFullscreenElement ) === this._canvas;
	}
	get isOctaveBands() {
		return this._isOctaveBands;
	}
	get isLedDisplay() {
		return this._isLedDisplay;
	}
	get isLumiBars() {
		return this._isLumiBars;
	}
	get isOn() {
		return this._animationReq !== undefined;
	}
	get output() {
		return this._output;
	}
	get peakEnergy() {
		return this._energy.peak;
	}
	get pixelRatio() {
		return this._pixelRatio;
	}
	static get version() {
		return _VERSION;
	}

	/**
	 * ==========================================================================
     *
	 * PUBLIC METHODS
	 *
	 * ==========================================================================
	 */

	/**
	 * Connect HTML audio element to analyzer
	 *
	 * @param {object} element HTML audio element
	 * @returns {object} a MediaElementAudioSourceNode object
	 */
	connectAudio( element ) {
		const audioSource = this._audioCtx.createMediaElementSource( element );
		audioSource.connect( this._input );
		if ( this._audioSource === undefined )
			this._audioSource = audioSource;
		return audioSource;
	}

	/**
	 * Registers a custom gradient
	 *
	 * @param {string} name
	 * @param {object} options
	 */
	registerGradient( name, options ) {
		if ( typeof name !== 'string' || name.trim().length == 0 )
			throw new AudioMotionError( 'ERR_GRADIENT_INVALID_NAME', 'Gradient name must be a non-empty string' );

		if ( typeof options !== 'object' )
			throw new AudioMotionError( 'ERR_GRADIENT_NOT_AN_OBJECT', 'Gradient options must be an object' );

		if ( options.colorStops === undefined || options.colorStops.length < 2 )
			throw new AudioMotionError( 'ERR_GRADIENT_MISSING_COLOR', 'Gradient must define at least two colors' );

		this._gradients[ name ] = {};

		if ( options.bgColor !== undefined )
			this._gradients[ name ].bgColor = options.bgColor;
		else
			this._gradients[ name ].bgColor = '#111';

		if ( options.dir !== undefined )
			this._gradients[ name ].dir = options.dir;

		this._gradients[ name ].colorStops = options.colorStops;

		this._generateGradients();
	}

	/**
	 * Set dimensions of analyzer's canvas
	 *
	 * @param {number} w width in pixels
	 * @param {number} h height in pixels
	 */
	setCanvasSize( w, h ) {
		this._width = w;
		this._height = h;
		this._setCanvas('user');
	}

	/**
	 * Set desired frequency range
	 *
	 * @param {number} min lowest frequency represented in the x-axis
	 * @param {number} max highest frequency represented in the x-axis
	 */
	setFreqRange( min, max ) {
		if ( min < 1 || max < 1 )
			throw new AudioMotionError( 'ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1` );
		else {
			this._minFreq = Math.min( min, max );
			this._maxFreq = Math.max( min, max );
			this._precalculateBarPositions();
		}
	}

	/**
	 * Shorthand function for setting several options at once
	 *
	 * @param {object} options
	 */
	setOptions( options ) {
		this._setProperties( options );
	}

	/**
	 * Adjust the analyzer's sensitivity
	 *
	 * @param {number} min minimum decibels value
	 * @param {number} max maximum decibels value
	 */
	setSensitivity( min, max ) {
		for ( let i = 0; i < 2; i++ ) {
			this._analyzer[ i ].minDecibels = Math.min( min, max );
			this._analyzer[ i ].maxDecibels = Math.max( min, max );
		}
	}

	/**
	 * Start / stop canvas animation
	 *
	 * @param {boolean} [value] if undefined, inverts the current status
	 * @returns {boolean} resulting status after the change
	 */
	toggleAnalyzer( value ) {
		const started = this.isOn;

		if ( value === undefined )
			value = ! started;

		if ( started && ! value ) {
			cancelAnimationFrame( this._animationReq );
			this._animationReq = undefined;
		}
		else if ( ! started && value ) {
			this._frame = this._fps = 0;
			this._time = performance.now();
			this._animationReq = requestAnimationFrame( timestamp => this._draw( timestamp ) );
		}

		return this.isOn;
	}

	/**
	 * Toggles canvas full-screen mode
	 */
	toggleFullscreen() {
		if ( this.isFullscreen ) {
			if ( document.exitFullscreen )
				document.exitFullscreen();
			else if ( document.webkitExitFullscreen )
				document.webkitExitFullscreen();
		}
		else {
			if ( this._canvas.requestFullscreen )
				this._canvas.requestFullscreen();
			else if ( this._canvas.webkitRequestFullscreen )
				this._canvas.webkitRequestFullscreen();
		}
	}

	/**
	 * ==========================================================================
	 *
	 * PRIVATE METHODS
	 *
	 * ==========================================================================
	 */

	/**
	 * Returns the frequency represented by a given FFT bin
	 *
	 * @param {number} bin FFT data array index
	 * @returns {number}   Frequency in hertz
	 */
	_binToFreq( bin ) {
		return bin * this._audioCtx.sampleRate / this._analyzer[0].fftSize;
	}

	/**
	 * Returns the FFT bin which more closely corresponds to a given frequency
	 *
	 * @param {number} freq       Frequency in hertz
	 * @param {string} [rounding] Rounding function: 'floor', 'round' (default) or 'ceil'
	 * @returns {number}          FFT data array index (integer)
	 */
	_freqToBin( freq, rounding ) {
		if ( ! ['floor','ceil'].includes( rounding ) )
			rounding = 'round';

		const bin = Math[ rounding ]( freq * this._analyzer[0].fftSize / this._audioCtx.sampleRate );

		return bin < this._analyzer[0].frequencyBinCount ? bin : this._analyzer[0].frequencyBinCount - 1;
	}

	/**
	 * Calculate internal values and flags used during each frame rendering
	 */
	_calculateInternals() {
		this._analyzerRadius = this._canvas.height * ( this._stereo ? .375 : .125 ) | 0;
		this._barSpacePx     = Math.min( this._barWidth - 1, ( this._barSpace > 0 && this._barSpace < 1 ) ? this._barWidth * this._barSpace : this._barSpace );
		this._channelHeight  = this._canvas.height >> ( this._stereo && ! this._radial );
		this._isOctaveBands  = ( this._mode % 10 != 0 );
		this._isLedDisplay   = ( this._showLeds && this._isOctaveBands && ! this._radial );
		this._isLumiBars     = ( this._lumiBars && this._isOctaveBands && ! this._radial );
	}

	/**
	 * Calculate attributes for the vintage LEDs effect, based on visualization mode and canvas resolution
	 */
	_calculateLedProperties() {
		if ( ! this._isOctaveBands || ! this._initDone )
			return;

		const analyzerHeight = this._channelHeight * ( this._lumiBars ? 1 : 1 - this._reflexRatio ) | 0;

		let spaceV = Math.min( 6, analyzerHeight / ( 90 * this._pixelRatio ) | 0 ); // for modes 3, 4, 5 and 6
		let nLeds;

		switch ( this._mode ) {
			case 8:
				spaceV = Math.min( 16, analyzerHeight / ( 33 * this._pixelRatio ) | 0 );
				nLeds = 24;
				break;
			case 7:
				spaceV = Math.min( 8, analyzerHeight / ( 67 * this._pixelRatio ) | 0 );
				nLeds = 48;
				break;
			case 6:
				nLeds = 64;
				break;
			case 5:
				// fall through
			case 4:
				nLeds = 80;
				break;
			case 3:
				nLeds = 96;
				break;
			case 2:
				spaceV = Math.min( 4, analyzerHeight / ( 135 * this._pixelRatio ) | 0 );
				nLeds = 128;
				break;
			case 1:
				spaceV = Math.min( 3, Math.max( 2, analyzerHeight / ( 180 * this._pixelRatio ) | 0 ) );
				nLeds = 128;
		}

		// make sure spaceV is at least 1px
		spaceV = Math.max( spaceV, 1 ) * this._pixelRatio;

		// recalculate the number of leds, considering the effective spaceV
		nLeds = Math.min( nLeds, ( analyzerHeight + spaceV ) / ( spaceV * 2 ) | 0 );

		this._ledOptions = {
			nLeds,
			spaceH: this._barWidth * ( this._mode == 1 ? .45 : this._mode < 5 ? .225 : .125 ),
			spaceV,
			ledHeight: ( analyzerHeight + spaceV ) / nLeds - spaceV
		};
	}

	/**
	 * Redraw the canvas
	 * this is called 60 times per second by requestAnimationFrame()
	 */
	_draw( timestamp ) {
		const canvas         = this._canvas,
			  ctx            = this._canvasCtx,
			  isOctaveBands  = this._isOctaveBands,
			  isLedDisplay   = this._isLedDisplay,
			  isLumiBars     = this._isLumiBars,
			  channelHeight  = this._channelHeight,
			  analyzerHeight = channelHeight * ( isLumiBars || this._radial ? 1 : 1 - this._reflexRatio ) | 0;

		// radial related constants
		const centerX        = canvas.width >> 1,
			  centerY        = canvas.height >> 1,
			  radius         = this._analyzerRadius,
			  tau            = 2 * Math.PI;

		if ( this._energy.instant > 0 )
			this._spinAngle += this._spinSpeed * tau / 3600;

		// helper function - convert planar X,Y coordinates to radial coordinates
		const radialXY = ( x, y ) => {
			const height = radius + y,
				  angle  = tau * ( x / canvas.width ) + this._spinAngle;

			return [ centerX + height * Math.cos( angle ), centerY + height * Math.sin( angle ) ];
		}

		// helper function - draw a polygon of width `w` and height `h` at (x,y) in radial mode
		const radialPoly = ( x, y, w, h ) => {
			ctx.moveTo( ...radialXY( x, y ) );
			ctx.lineTo( ...radialXY( x, y + h ) );
			ctx.lineTo( ...radialXY( x + w, y + h ) );
			ctx.lineTo( ...radialXY( x + w, y ) );
		}

		// clear the canvas, if in overlay mode
		if ( this.overlay )
			ctx.clearRect( 0, 0, canvas.width, canvas.height );

		// select background color
		const bgColor = ( ! this.showBgColor || isLedDisplay && ! this.overlay ) ? '#000' : this._gradients[ this._gradient ].bgColor;

		// compute the effective bar width, considering the selected bar spacing
		// if led effect is active, ensure at least the spacing defined by the led options
		let width = this._barWidth - ( ! isOctaveBands ? 0 : Math.max( isLedDisplay ? this._ledOptions.spaceH : 0, this._barSpacePx ) );

		// make sure width is integer for pixel accurate calculation, when no bar spacing is required
		if ( this._barSpace == 0 && ! isLedDisplay )
			width |= 0;

		let energy = 0;

		const nBars = this._analyzerBars.length;

		for ( let channel = 0; channel < this._stereo + 1; channel++ ) {

			const channelTop     = channelHeight * channel,
				  channelBottom  = channelHeight << channel,
				  analyzerBottom = channelTop + analyzerHeight;

			// fill the analyzer background if needed
			if ( ! this.overlay || this.showBgColor ) {
				if ( this.overlay )
					ctx.globalAlpha = this.bgAlpha;

				ctx.fillStyle = bgColor;

				// exclude the reflection area when overlay is true and reflexAlpha == 1 (avoids alpha over alpha difference, in case bgAlpha < 1)
				if ( ! this._radial || channel == 0 )
					ctx.fillRect( 0, channelTop, canvas.width, ( this.overlay && this.reflexAlpha == 1 ) ? analyzerHeight : channelHeight );

				ctx.globalAlpha = 1;
			}

			// draw dB scale (Y-axis)
			if ( this.showScaleY && ! isLumiBars && ! this._radial ) {
				const scaleWidth  = this._labels.height,
					  scaleHeight = analyzerHeight - ( this.showScale && this.reflexRatio == 0 ? this._labels.height : 0 ),
					  fontSize    = scaleWidth >> 1,
					  interval    = analyzerHeight / ( this._analyzer[0].maxDecibels - this._analyzer[0].minDecibels );

				ctx.fillStyle = '#888';
				ctx.font = `${fontSize}px sans-serif`;
				ctx.textAlign = 'right';
				ctx.lineWidth = 1;

				for ( let db = this._analyzer[0].maxDecibels; db > this._analyzer[0].minDecibels; db -= 5 ) {
					const posY = channelTop + ( this._analyzer[0].maxDecibels - db ) * interval,
						  even = ( db % 2 == 0 ) | 0;

					if ( even ) {
						const labelY = posY + fontSize * ( posY == channelTop ? .8 : .35 );
						ctx.fillText( db, scaleWidth * .85, labelY );
						ctx.fillText( db, canvas.width - scaleWidth * .1, labelY );
						ctx.strokeStyle = '#888';
						ctx.setLineDash([2,4]);
						ctx.lineDashOffset = 0;
					}
					else {
						ctx.strokeStyle = '#555';
						ctx.setLineDash([2,8]);
						ctx.lineDashOffset = 1;
					}

					ctx.beginPath();
					ctx.moveTo( scaleWidth * even, ~~posY + .5 ); // for sharp 1px line (https://stackoverflow.com/a/13879402/2370385)
					ctx.lineTo( canvas.width - scaleWidth * even, ~~posY + .5 );
					ctx.stroke();
				}
				// restore line properties
				ctx.setLineDash([]);
				ctx.lineDashOffset = 0;
			}

			// set line width and dash for LEDs effect
			if ( isLedDisplay ) {
				ctx.setLineDash( [ this._ledOptions.ledHeight, this._ledOptions.spaceV ] );
				ctx.lineWidth = width;
			}

			// set selected gradient for fill and stroke
			ctx.fillStyle = ctx.strokeStyle = this._gradients[ this._gradient ].gradient;

			// get a new array of data from the FFT
			this._analyzer[ channel ].getByteFrequencyData( this._dataArray );

			// start drawing path
			ctx.beginPath();

			// in line / graph mode, line starts off screen
			if ( this._mode == 10 && ! this._radial )
				ctx.moveTo( -this.lineWidth, analyzerBottom );

			// draw bars / lines

			for ( let i = 0; i < nBars; i++ ) {

				let bar = this._analyzerBars[ i ],
					barHeight = 0;

				if ( bar.endIdx == 0 ) { // single FFT bin
					barHeight = this._dataArray[ bar.dataIdx ];
					// apply smoothing factor when several bars share the same bin
					if ( bar.factor )
						barHeight += ( this._dataArray[ bar.dataIdx + 1 ] - barHeight ) * bar.factor;
				}
				else { 					// range of bins
					// use the highest value in the range
					for ( let j = bar.dataIdx; j <= bar.endIdx; j++ )
						barHeight = Math.max( barHeight, this._dataArray[ j ] );
				}

				barHeight /= 255;
				energy += barHeight;

				// set opacity for lumi bars before barHeight value is normalized
				if ( isLumiBars )
					ctx.globalAlpha = barHeight;

				if ( isLedDisplay ) { // normalize barHeight to match one of the "led" elements
					barHeight = ( barHeight * this._ledOptions.nLeds | 0 ) * ( this._ledOptions.ledHeight + this._ledOptions.spaceV ) - this._ledOptions.spaceV;
					if ( barHeight < 0 )
						barHeight = 0; // prevent showing leds below 0 when overlay and reflex are active
				}
				else
					barHeight = barHeight * ( this._radial ? centerY - radius : analyzerHeight ) | 0;

				if ( barHeight >= bar.peak[ channel ] ) {
					bar.peak[ channel ] = barHeight;
					bar.hold[ channel ] = 30; // set peak hold time to 30 frames (0.5s)
					bar.accel[ channel ] = 0;
				}

				if ( this._radial && channel == 1 )
					barHeight *= -1;

				let posX = bar.posX;
				let adjWidth = width; // bar width may need small adjustments for some bars, when barSpace == 0

				// Draw line / bar
				if ( this._mode == 10 ) {
					if ( ! this._radial )
						ctx.lineTo( bar.posX, analyzerBottom - barHeight );
					else if ( bar.posX >= 0 ) // avoid overlapping wrap-around frequencies
						ctx.lineTo( ...radialXY( bar.posX, barHeight ) );
				}
				else {
					if ( this._mode > 0 ) {
						if ( isLedDisplay )
							posX += Math.max( this._ledOptions.spaceH / 2, this._barSpacePx / 2 );
						else {
							if ( this._barSpace == 0 ) {
								posX |= 0;
								if ( i > 0 && posX > this._analyzerBars[ i - 1 ].posX + width ) {
									posX--;
									adjWidth++;
								}
							}
							else
								posX += this._barSpacePx / 2;
						}
					}

					if ( isLedDisplay ) {
						const x = posX + width / 2;
						// draw "unlit" leds
						if ( this.showBgColor && ! this.overlay ) {
							const alpha = ctx.globalAlpha;
							ctx.beginPath();
							ctx.moveTo( x, channelTop );
							ctx.lineTo( x, analyzerBottom );
							ctx.strokeStyle = '#7f7f7f22';
							ctx.globalAlpha = 1;
							ctx.stroke();
							// restore properties
							ctx.strokeStyle = ctx.fillStyle;
							ctx.globalAlpha = alpha;
						}
						ctx.beginPath();
						ctx.moveTo( x, isLumiBars ? channelTop : analyzerBottom );
						ctx.lineTo( x, isLumiBars ? channelBottom : analyzerBottom - barHeight );
						ctx.stroke();
					}
					else if ( ! this._radial ) {
						ctx.fillRect( posX, isLumiBars ? channelTop : analyzerBottom, adjWidth, isLumiBars ? channelBottom : -barHeight );
					}
					else if ( bar.posX >= 0 ) {
						radialPoly( posX, 0, adjWidth, barHeight );
					}
				}

				// Draw peak
				if ( bar.peak[ channel ] > 0 ) {
					if ( this.showPeaks && ! isLumiBars ) {
						if ( isLedDisplay ) {
							// convert the bar height to the position of the corresponding led element
							const fullLeds = bar.peak[ channel ] / ( analyzerHeight + this._ledOptions.spaceV ) * this._ledOptions.nLeds | 0,
								  posY = ( this._ledOptions.nLeds - fullLeds - 1 ) * ( this._ledOptions.ledHeight + this._ledOptions.spaceV );

							ctx.fillRect( posX,	channelTop + posY, width, this._ledOptions.ledHeight );
						}
						else if ( ! this._radial ) {
							ctx.fillRect( posX, analyzerBottom - bar.peak[ channel ], adjWidth, 2 );
						}
						else if ( this.mode != 10 && bar.posX >= 0 ) { // radial - no peaks for mode 10 or wrap-around frequencies
							radialPoly( posX, bar.peak[ channel ] * ( channel == 1 ? -1 : 1 ), adjWidth, -2 );
						}
					}

					if ( bar.hold[ channel ] )
						bar.hold[ channel ]--;
					else {
						bar.accel[ channel ]++;
						bar.peak[ channel ] -= bar.accel[ channel ];
					}
				}
			} // for ( let i = 0; i < nBars; i++ )

			// restore global alpha
			ctx.globalAlpha = 1;

			// Fill/stroke drawing path for mode 10 and radial
			if ( this._mode == 10 ) {
				if ( this._radial )
					ctx.closePath();
				else
					ctx.lineTo( canvas.width + this.lineWidth, analyzerBottom );

				if ( this.lineWidth > 0 ) {
					ctx.lineWidth = this.lineWidth;
					ctx.stroke();
				}

				if ( this.fillAlpha > 0 ) {
					if ( this._radial ) {
						// exclude the center circle from the fill area
						ctx.moveTo( centerX + radius, centerY );
						ctx.arc( centerX, centerY, radius, 0, tau, true );
					}
					ctx.globalAlpha = this.fillAlpha;
					ctx.fill();
					ctx.globalAlpha = 1;
				}
			}
			else if ( this._radial ) {
				ctx.fill();
			}

			// Reflex effect
			if ( this._reflexRatio > 0 && ! isLumiBars ) {
				let posY, height;
				if ( this.reflexFit || this._stereo ) { // always fit reflex in stereo mode
					posY   = this._stereo ? channelHeight * ( 1 - channel ) : 0;
					height = channelHeight - analyzerHeight;
				}
				else {
					posY   = canvas.height - analyzerHeight * 2;
					height = analyzerHeight;
				}

				// set alpha and brightness for the reflection
				ctx.globalAlpha = this.reflexAlpha;
				if ( this.reflexBright != 1 )
					ctx.filter = `brightness(${this.reflexBright})`;

				// create the reflection
				ctx.setTransform( 1, 0, 0, -1, 0, canvas.height );
				ctx.drawImage( canvas, 0, channelTop, canvas.width, analyzerHeight, 0, posY, canvas.width, height );

				// reset changed properties
				ctx.setTransform();
				ctx.filter = 'none';
				ctx.globalAlpha = 1;
			}

		} // for ( let channel = 0; channel < this._stereo + 1; channel++ ) {

		// Update instant and peak energy
		this._energy.instant = energy / ( nBars << this._stereo );
		if ( this._energy.instant >= this._energy.peak ) {
			this._energy.peak = this._energy.instant;
			this._energy.hold = 30;
		}
		else {
			if ( this._energy.hold > 0 )
				this._energy.hold--;
			else if ( this._energy.peak > 0 )
				this._energy.peak *= ( 30 + this._energy.hold-- ) / 30; // decay (drops to zero in 30 frames)
		}

		// restore solid lines
		ctx.setLineDash([]);

		// draw frequency scale (X-axis)
		if ( this.showScale ) {
			if ( this._radial ) {
				ctx.save();
				ctx.translate( centerX, centerY );
				if ( this._spinSpeed != 0 )
					ctx.rotate( this._spinAngle + Math.PI / 2 );
				ctx.drawImage( this._circScale, -this._circScale.width >> 1, -this._circScale.width >> 1 );
				ctx.restore();
			}
			else
				ctx.drawImage( this._labels, 0, canvas.height - this._labels.height );
		}

		// calculate and update current frame rate

		this._frame++;
		const elapsed = timestamp - this._time;

		if ( elapsed >= 1000 ) {
			this._fps = this._frame / ( elapsed / 1000 );
			this._frame = 0;
			this._time = timestamp;
		}
		if ( this.showFPS ) {
			const size = 20 * this._pixelRatio;
			ctx.font = `bold ${size}px sans-serif`;
			ctx.fillStyle = '#0f0';
			ctx.textAlign = 'right';
			ctx.fillText( Math.round( this._fps ), canvas.width - size, size * 2 );
		}

		// call callback function, if defined
		if ( this.onCanvasDraw ) {
			ctx.save();
			ctx.fillStyle = ctx.strokeStyle = this._gradients[ this._gradient ].gradient;
			this.onCanvasDraw( this );
			ctx.restore();
		}

		// schedule next canvas update
		this._animationReq = requestAnimationFrame( timestamp => this._draw( timestamp ) );
	}

	/**
	 * Generate gradients
	 */
	_generateGradients() {

		const isOctaveBands  = this._isOctaveBands,
			  isLumiBars     = this._isLumiBars,
			  analyzerHeight = isLumiBars ? this._canvas.height : this._canvas.height * ( 1 - this._reflexRatio * ! this._stereo ) | 0,
			  					// for stereo we keep the full canvas height and handle the reflex areas while generating the color stops
			  analyzerRatio  = 1 - this._reflexRatio;

		// for radial mode
		const centerX = this._canvas.width >> 1,
			  centerY = this._canvas.height >> 1,
			  radius  = this._analyzerRadius;

		Object.keys( this._gradients ).forEach( key => {

			let grad;

			if ( this._radial )
				grad = this._canvasCtx.createRadialGradient( centerX, centerY, centerY, centerX, centerY, radius - ( centerY - radius ) * this._stereo );
			else if ( this._gradients[ key ].dir && this._gradients[ key ].dir == 'h' )
				grad = this._canvasCtx.createLinearGradient( 0, 0, this._canvas.width, 0 );
			else
				grad = this._canvasCtx.createLinearGradient( 0, 0, 0, analyzerHeight );

			const colorStops = this._gradients[ key ].colorStops;

			if ( colorStops ) {
				const isSplit = this._gradients[ key ].dir != 'h' && this._stereo && this._splitGradient;

				// helper function
				const addColorStop = ( offset, colorInfo ) => grad.addColorStop( offset, typeof colorInfo == 'object' ? colorInfo.color : colorInfo );

				for ( let i = 0; i < 1 + isSplit; i++ ) {
					colorStops.forEach( ( colorInfo, index ) => {

						const maxIndex = colorStops.length - 1;

						let offset = colorInfo.pos !== undefined ? colorInfo.pos : index / maxIndex;

						// in split mode, use half the original offset for each channel
						if ( isSplit )
							offset /= 2;

						// constrain the offset within the useful analyzer areas (avoid reflex areas)
						if ( this._stereo && ! isLumiBars && ! this._radial ) {
							offset *= analyzerRatio;
							// skip the first reflex area in continuous mode (spliGradient == false)
							if ( ! isSplit && offset > .5 * analyzerRatio )
								offset += .5 * this._reflexRatio;
						}

						// second channel (when in split mode)
						if ( i == 1 ) {
							// for radial gradients, we need to add colors in reverse order now
							if ( this._radial ) {
								const revIndex = maxIndex - index;
								colorInfo = colorStops[ revIndex ];
								offset = 1 - ( colorInfo.pos !== undefined ? colorInfo.pos : revIndex / maxIndex ) / 2;
							}
							else {
								// if the first offset is not 0, create an additional color stop to prevent bleeding from the first channel
								if ( index == 0 && offset > 0 )
									addColorStop( .5, colorInfo );
								// bump the offset to the second half of the gradient
								offset += .5;
							}
						}

						// add gradient color stop
						addColorStop( offset, colorInfo );

						// create additional color stop at the end of first channel to prevent bleeding
						if ( this._stereo && index == maxIndex && offset < .5 )
							addColorStop( .5, colorInfo );
					});
				}
			}

			this._gradients[ key ].gradient = grad; // save the generated gradient back into the gradients array
		});
	}

	/**
	 * Generate the X-axis and radial scales in auxiliary canvases
	 */
	_generateScaleX() {
		const tau         = 2 * Math.PI,
			  freqLabels  = [ 16, 31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 ],
			  scaleHeight = this._canvas.height * .03 | 0; // circular scale height (radial mode)

		// in radial stereo mode, the scale is positioned exactly between both channels, by making the canvas a bit larger than the central diameter
		this._circScale.width = this._circScale.height = ( this._analyzerRadius << 1 ) + ( this._stereo * scaleHeight );

		const radius  = this._circScale.width >> 1, // this is also used as the center X and Y coordinates of the circular scale canvas
			  radialY = radius - scaleHeight * .7;	// vertical position of text labels in the circular scale

		// clear scale canvas
		this._labels.width |= 0;

		this._labelsCtx.fillStyle = this._circScaleCtx.strokeStyle = '#000c';
		this._labelsCtx.fillRect( 0, 0, this._labels.width, this._labels.height );

		this._circScaleCtx.arc( radius, radius, radius - scaleHeight / 2, 0, tau );
		this._circScaleCtx.lineWidth = scaleHeight;
		this._circScaleCtx.stroke();

		this._labelsCtx.fillStyle = this._circScaleCtx.fillStyle = '#fff';
		this._labelsCtx.font = `${ this._labels.height >> 1 }px sans-serif`;
		this._circScaleCtx.font = `${ scaleHeight >> 1 }px sans-serif`;
		this._labelsCtx.textAlign = this._circScaleCtx.textAlign = 'center';

		for ( const freq of freqLabels ) {
			const label = ( freq >= 1000 ) ? `${ freq / 1000 }k` : freq,
				  x     = this._bandWidth * ( Math.log10( freq ) - this._minLog );

			this._labelsCtx.fillText( label, x,	this._labels.height * .75 );

			// avoid overlapping wrap-around labels in the circular scale
			if ( x > 0 && x < this._canvas.width ) {
				const angle  = tau * ( x / this._canvas.width ),
					  adjAng = angle - Math.PI / 2, // rotate angles so 0 is at the top
					  posX   = radialY * Math.cos( adjAng ),
					  posY   = radialY * Math.sin( adjAng );

				this._circScaleCtx.save();
				this._circScaleCtx.translate( radius + posX, radius + posY );
				this._circScaleCtx.rotate( angle );
				this._circScaleCtx.fillText( label, 0, 0 );
				this._circScaleCtx.restore();
			}
		}
	}

	/**
	 * Precalculate the actual X-coordinate on screen for each analyzer bar
	 *
	 * Since the frequency scale is logarithmic, each position in the X-axis actually represents a power of 10.
	 * To improve performace, the position of each frequency is calculated in advance and stored in an array.
	 * Canvas space usage is optimized to accommodate exactly the frequency range the user needs.
	 * Positions need to be recalculated whenever the frequency range, FFT size or canvas size change.
	 *
	 *                              +-------------------------- canvas --------------------------+
	 *                              |                                                            |
	 *    |-------------------|-----|-------------|-------------------!-------------------|------|------------|
	 *    1                  10     |            100                  1K                 10K     |           100K (Hz)
	 * (10^0)              (10^1)   |          (10^2)               (10^3)              (10^4)   |          (10^5)
	 *                              |-------------|<--- bandWidth --->|--------------------------|
	 *                  minFreq--> 20                   (pixels)                                22K <--maxFreq
	 *                          (10^1.3)                                                     (10^4.34)
	 *                           minLog
	 */
	_precalculateBarPositions() {

		if ( ! this._initDone )
			return;

		let minLog, bandWidth;

		this._analyzerBars = [];

		if ( ! this._isOctaveBands ) {
		// Discrete frequencies or area fill modes
			this._barWidth = 1;

			minLog = Math.log10( this._minFreq );
			bandWidth = this._canvas.width / ( Math.log10( this._maxFreq ) - minLog );

			const minIndex = this._freqToBin( this._minFreq, 'floor' );
			const maxIndex = this._freqToBin( this._maxFreq );

	 		let lastPos = -999;

			for ( let i = minIndex; i <= maxIndex; i++ ) {
				const freq = this._binToFreq( i ); // frequency represented by this index
				const pos = Math.round( bandWidth * ( Math.log10( freq ) - minLog ) ); // avoid fractionary pixel values

				// if it's on a different X-coordinate, create a new bar for this frequency
				if ( pos > lastPos ) {
					this._analyzerBars.push( { posX: pos, dataIdx: i, endIdx: 0, factor: 0, peak: [0,0], hold: [], accel: [] } );
					lastPos = pos;
				} // otherwise, add this frequency to the last bar's range
				else if ( this._analyzerBars.length )
					this._analyzerBars[ this._analyzerBars.length - 1 ].endIdx = i;
			}
		}
		else {
		// Octave bands modes

			// how many notes grouped in each band?
			let groupNotes;

			if ( this._mode == 8 )
				groupNotes = 24;
			else if ( this._mode == 7 )
				groupNotes = 12;
			else if ( this._mode == 6 )
				groupNotes = 8;
			else if ( this._mode == 5 )
				groupNotes = 6;
			else
				groupNotes = this._mode; // for modes 1, 2, 3 and 4

			// generate a table of frequencies based on the equal tempered scale

			const root24 = 2 ** ( 1 / 24 );
			const c0 = 440 * root24 ** -114; // ~16.35 Hz

			let temperedScale = [];
			let i = 0;
			let freq;

			while ( ( freq = c0 * root24 ** i ) <= this._maxFreq ) {
				if ( freq >= this._minFreq && i % groupNotes == 0 )
					temperedScale.push( freq );
				i++;
			}

			minLog = Math.log10( temperedScale[0] );
			bandWidth = this._canvas.width / ( Math.log10( temperedScale[ temperedScale.length - 1 ] ) - minLog );

			// divide canvas space by the number of frequencies (bars) to display
			this._barWidth = this._canvas.width / temperedScale.length;

			let prevBin = 0;  // last bin included in previous frequency band
			let prevIdx = -1; // previous bar FFT array index
			let nBars   = 0;  // count of bars with the same index

			temperedScale.forEach( ( freq, index ) => {
				// which FFT bin best represents this frequency?
				const bin = this._freqToBin( freq );

				let idx, nextBin;
				// start from the last used FFT bin
				if ( prevBin > 0 && prevBin + 1 <= bin )
					idx = prevBin + 1;
				else
					idx = bin;

				// FFT does not provide many coefficients for low frequencies, so several bars may end up using the same data
				if ( idx == prevIdx ) {
					nBars++;
				}
				else {
					// update previous bars using the same index with a smoothing factor
					if ( nBars > 1 ) {
						for ( let i = 1; i <= nBars; i++ )
							this._analyzerBars[ this._analyzerBars.length - i ].factor = ( nBars - i ) / nBars;
					}
					prevIdx = idx;
					nBars = 1;
				}

				prevBin = nextBin = bin;
				// check if there's another band after this one
				if ( temperedScale[ index + 1 ] !== undefined ) {
					nextBin = this._freqToBin( temperedScale[ index + 1 ] );
					// and use half the bins in between for this band
					if ( nextBin - bin > 1 )
						prevBin += Math.round( ( nextBin - bin ) / 2 );
				}

				const endIdx = prevBin - idx > 0 ? prevBin : 0;

				this._analyzerBars.push( {
					posX: index * this._barWidth,
					dataIdx: idx,
					endIdx,
//					freq, // nominal frequency for this band
//					range: [ this._binToFreq( idx ), this._binToFreq( endIdx || idx ) ], // actual range of frequencies
					factor: 0,
					peak: [0,0],
					hold: [],
					accel: []
				} );

			} );
		}

		// save these for scale generation
		this._minLog = minLog;
		this._bandWidth = bandWidth;

		// update internal variables
		this._calculateInternals();

		// generate the X-axis and radial scales
		this._generateScaleX();

		// update LED properties
		this._calculateLedProperties();
	}

	/**
	 * Internal function to change canvas dimensions on demand
	 */
	_setCanvas( reason ) {
		// if initialization is not finished, quit
		if ( ! this._initDone )
			return;

		this._pixelRatio = window.devicePixelRatio; // for Retina / HiDPI devices

		if ( this._loRes )
			this._pixelRatio /= 2;

		this._fsWidth = Math.max( window.screen.width, window.screen.height ) * this._pixelRatio;
		this._fsHeight = Math.min( window.screen.height, window.screen.width ) * this._pixelRatio;

		const isFullscreen = this.isFullscreen,
			  newWidth  = isFullscreen ? this._fsWidth  : ( this._width  || this._container.clientWidth  || this._defaultWidth )  * this._pixelRatio | 0,
			  newHeight = isFullscreen ? this._fsHeight : ( this._height || this._container.clientHeight || this._defaultHeight ) * this._pixelRatio | 0;

		// workaround for wrong dPR reported on Android TV
		if ( this._pixelRatio == 2 && window.screen.height <= 540 )
			this._pixelRatio = 1;

		// if canvas dimensions haven't changed, quit
		if ( this._canvas.width == newWidth && this._canvas.height == newHeight )
			return;

		// apply new dimensions
		this._canvas.width  = newWidth;
		this._canvas.height = newHeight;

		// update internal variables
		this._calculateInternals();

		// if not in overlay mode, paint the canvas black
		if ( ! this.overlay ) {
			this._canvasCtx.fillStyle = '#000';
			this._canvasCtx.fillRect( 0, 0, this._canvas.width, this._canvas.height );
		}

		// set lineJoin property for area fill mode (this is reset whenever the canvas size changes)
		this._canvasCtx.lineJoin = 'bevel';

		// update dimensions of the scale canvas
		this._labels.width = this._canvas.width;
		this._labels.height = Math.max( 20 * this._pixelRatio, this._canvas.height / 27 | 0 );

		// (re)generate gradients
		this._generateGradients();

		// calculate bar positions and led options
		this._precalculateBarPositions();

		// detect fullscreen changes (for Safari)
		if ( this._fsStatus !== undefined && this._fsStatus !== isFullscreen )
			reason = 'fschange';
		this._fsStatus = isFullscreen;

		// call the callback function, if defined
		if ( this.onCanvasResize )
			this.onCanvasResize( reason, this );
	}

	/**
	 * Set object properties
	 */
	_setProperties( options, useDefaults ) {

		// settings defaults
		const defaults = {
			mode         : 0,
			fftSize      : 8192,
			minFreq      : 20,
			maxFreq      : 22000,
			smoothing    : 0.5,
			gradient     : 'classic',
			minDecibels  : -85,
			maxDecibels  : -25,
			showBgColor  : true,
			showLeds     : false,
			showScale    : true,
			showScaleY   : false,
			showPeaks    : true,
			showFPS      : false,
			lumiBars     : false,
			loRes        : false,
			reflexRatio  : 0,
			reflexAlpha  : 0.15,
			reflexBright : 1,
			reflexFit    : true,
			lineWidth    : 0,
			fillAlpha    : 1,
			barSpace     : 0.1,
			overlay      : false,
			bgAlpha      : 0.7,
			radial		 : false,
			spinSpeed    : 0,
			stereo       : false,
			splitGradient: true,
			start        : true
		};

		// callback functions properties
		const callbacks = [ 'onCanvasDraw', 'onCanvasResize' ];

		// audioCtx is set only at initialization; we handle 'start' after setting all other properties
		const ignore = [ 'audioCtx', 'start' ];

		if ( useDefaults || options === undefined )
			options = Object.assign( defaults, options );

		for ( const prop of Object.keys( options ) ) {
			if ( callbacks.indexOf( prop ) !== -1 && typeof options[ prop ] !== 'function' ) // check invalid callback
				this[ prop ] = undefined;
			else if ( ignore.indexOf( prop ) === -1 ) // skip ignored properties
				this[ prop ] = options[ prop ];
		}

		if ( options.start !== undefined )
			this.toggleAnalyzer( options.start );
	}

}

/* Custom error class */

class AudioMotionError extends Error {
	constructor( code, message ) {
		super( message );
		this.name = 'AudioMotionError';
		this.code = code;
	}
}
