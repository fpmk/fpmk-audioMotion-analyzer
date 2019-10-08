/**
 * audioMotion-analyzer
 * High-resolution real-time graphic audio spectrum analyzer JS module
 *
 * https://github.com/hvianna/audioMotion-analyzer
 *
 * @author    Henrique Vianna <hvianna@gmail.com>
 * @copyright (c) 2018-2019 Henrique Avila Vianna
 * @license   AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export default class AudioMotionAnalyzer {

/*
	TO DO:

	use public and private class fields and methods when they become standard?
	https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Class_fields

	// current visualization settings
	mode, minFreq, maxFreq, gradient, showBgColor, showLeds, showScale, showPeaks, loRes, showFPS;

	// Web Audio API related variables
	audioCtx, analyzer, dataArray;

	// data for drawing the analyzer bars and scale-related variables
	#analyzerBars, #barWidth, #ledOptions, #freqLabels;

	// canvas-related variables
	canvas, canvasCtx, pixelRatio, width, height, fsWidth, fsHeight, fps;
	#animationReq, #drawCallback, #ledsMask, #ledsCtx, #time, #frame, #canvasResizeCallback;

	// settings defaults and gradient definitions
	#defaults, #gradients;

*/

/**
 * CONSTRUCTOR
 *
 * @param {object} [container] DOM element where to insert the analyzer; if undefined, uses the document body
 * @param {object} [options]
 * @returns {object} AudioMotionAnalyzer object
 */
	constructor( container, options = {} ) {

		// Settings defaults

		this._defaults = {
			mode        : 0,
			fftSize     : 8192,
			minFreq     : 20,
			maxFreq     : 22000,
			smoothing   : 0.5,
			gradient    : 'classic',
			minDecibels : -85,
			maxDecibels : -25,
			showBgColor : true,
			showLeds    : false,
			showScale   : true,
			showPeaks   : true,
			showFPS     : false,
			loRes       : false,
			width       : 640,
			height      : 270
		};

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
					'hsl( 240, 100%, 50% )',
				]
			},
			rainbow: {
				bgColor: '#111',
				dir: 'h',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					'hsl( 60, 100%, 50% )',
					'hsl( 120, 100%, 50% )',
					'hsl( 180, 100%, 50% )',
					'hsl( 240, 100%, 50% )',
					'hsl( 300, 100%, 50% )',
					'hsl( 360, 100%, 50% )'
				]
			},
		};

		// If container not specified, use document body

		this._container = container || document.body;

		// Create audio context

		var AudioContext = window.AudioContext || window.webkitAudioContext;

		try {
			this.audioCtx = new AudioContext();
		}
		catch( err ) {
			throw 'Could not create audio context. Web Audio API not supported?';
		}

		// Create analyzer node, connect audio source (if provided) and connect it to the destination

		this.analyzer = this.audioCtx.createAnalyser();
		this._audioSource = ( options.source ) ? this.connectAudio( options.source ) : undefined;
		this.analyzer.connect( this.audioCtx.destination );

		// Adjust settings

		this._defaults.width  = this._container.clientWidth  || this._defaults.width;
		this._defaults.height = this._container.clientHeight || this._defaults.height;

		this._mode       = options.mode        === undefined ? this._defaults.mode        : Number( options.mode );
		this._minFreq    = options.minFreq     === undefined ? this._defaults.minFreq     : options.minFreq;
		this._maxFreq    = options.maxFreq     === undefined ? this._defaults.maxFreq     : options.maxFreq;
		this.gradient    = options.gradient    === undefined ? this._defaults.gradient    : options.gradient;
		this.showBgColor = options.showBgColor === undefined ? this._defaults.showBgColor : options.showBgColor;
		this.showLeds    = options.showLeds    === undefined ? this._defaults.showLeds    : options.showLeds;
		this.showScale   = options.showScale   === undefined ? this._defaults.showScale   : options.showScale;
		this.showPeaks   = options.showPeaks   === undefined ? this._defaults.showPeaks   : options.showPeaks;
		this.showFPS     = options.showFPS     === undefined ? this._defaults.showFPS     : options.showFPS;
		this._loRes      = options.loRes       === undefined ? this._defaults.loRes       : options.loRes;
		this._width      = options.width;
		this._height     = options.height;

		this.analyzer.fftSize               = options.fftSize     === undefined ? this._defaults.fftSize     : options.fftSize;
		this.analyzer.smoothingTimeConstant = options.smoothing   === undefined ? this._defaults.smoothing   : options.smoothing;
		this.analyzer.minDecibels           = options.minDecibels === undefined ? this._defaults.minDecibels : options.minDecibels;
		this.analyzer.maxDecibels           = options.maxDecibels === undefined ? this._defaults.maxDecibels : options.maxDecibels;

		this._dataArray = new Uint8Array( this.analyzer.frequencyBinCount );

		this.onCanvasDraw = ( typeof options.onCanvasDraw == 'function' ) ? options.onCanvasDraw : undefined;
		this.onCanvasResize = ( typeof options.onCanvasResize == 'function' ) ? options.onCanvasResize : undefined;

		// Create canvas

		this.canvas = document.createElement('canvas');
		this.canvas.style = 'max-width: 100%;';
		this._container.appendChild( this.canvas );
		this.canvasCtx = this.canvas.getContext( '2d', { alpha: false } );
		this._setCanvas('create');

		// adjust canvas on window resize
		window.addEventListener( 'resize', () => {
			if ( ! this._width || ! this._height ) // fluid width or height
				this._setCanvas('resize');
		});

		// adjust canvas size on fullscreen change
		this.canvas.addEventListener( 'fullscreenchange', () => this._setCanvas('fschange') );

		// Start animation

		if ( options.start !== false )
			this.toggleAnalyzer( true );

	}

	/**
	 * ==========================================================================
	 *
	 * PUBLIC PROPERTIES GETTERS AND SETTERS
	 *
	 * ==========================================================================
	 */

	// FFT size

	get fftSize() {
		return this.analyzer.fftSize;
	}
	set fftSize( value ) {
		this.analyzer.fftSize = value;
		this._dataArray = new Uint8Array( this.analyzer.frequencyBinCount );
		this._precalculateBarPositions();
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
		this._mode = Number( value );
		this._precalculateBarPositions();
	}

	// Low-resolution mode

	get loRes() {
		return this._loRes;
	}
	set loRes( value ) {
		this._loRes = Boolean( value );
		this._setCanvas('lores');
	}

	// Current frequency range

	get minFreq() {
		return this._minFreq;
	}
	set minFreq( value ) {
		this._minFreq = value;
		this._precalculateBarPositions();
	}
	get maxFreq() {
		return this._maxFreq;
	}
	set maxFreq( value ) {
		this._maxFreq = value;
		this._precalculateBarPositions();
	}

	// Analyzer's sensitivity

	get minDecibels() {
		return this.analyzer.minDecibels;
	}
	set minDecibels( value ) {
		this.analyzer.minDecibels = value;
	}
	get maxDecibels() {
		return this.analyzer.maxDecibels;
	}
	set maxDecibels( value ) {
		this.analyzer.maxDecibels = value;
	}

	// Analyzer's smoothing time constant

	get smoothing() {
		return this.analyzer.smoothingTimeConstant;
	}
	set smoothing( value ) {
		this.analyzer.smoothingTimeConstant = value;
	}

	// Read only properties

	get audioSource() {
		return this._audioSource;
	}
	get dataArray() {
		return this._dataArray;
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
	get isFullscreen() {
		if ( document.fullscreenElement )
			return document.fullscreenElement === this.canvas;
		else if ( document.webkitFullscreenElement )
			return document.webkitFullscreenElement === this.canvas;
	}
	get isOn() {
		return this._animationReq !== undefined;
	}
	get pixelRatio() {
		return this._pixelRatio;
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
		var audioSource = this.audioCtx.createMediaElementSource( element );
		audioSource.connect( this.analyzer );
		return audioSource;
	}

	/**
	 * Registers a custom gradient
	 *
	 * @param {string} name
	 * @param {object} options
	 */
	registerGradient( name, options ) {
		if ( typeof options !== 'object' )
			throw 'Custom gradient options must be an object';

		if ( options.colorStops === undefined || options.colorStops.length < 2 )
			throw 'Custom gradient must define at least two colors!';

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
		this._minFreq = Math.min( min, max );
		this._maxFreq = Math.max( min, max );
		this._precalculateBarPositions();
	}

	/**
	 * Shorthand function for setting several options at once
	 *
	 * @param {object} options
	 */
	setOptions( options ) {

		if ( options.mode !== undefined )
			this._mode = Number( options.mode );

		if ( options.minFreq !== undefined )
			this._minFreq = options.minFreq;

		if ( options.maxFreq !== undefined )
			this._maxFreq = options.maxFreq;

		if ( options.gradient !== undefined )
			this.gradient = options.gradient;

		if ( options.showBgColor !== undefined )
			this.showBgColor = options.showBgColor;

		if ( options.showLeds !== undefined )
			this.showLeds = options.showLeds;

		if ( options.showScale !== undefined )
			this.showScale = options.showScale;

		if ( options.minDecibels !== undefined )
			this.analyzer.minDecibels = options.minDecibels;

		if ( options.maxDecibels !== undefined )
			this.analyzer.maxDecibels = options.maxDecibels;

		if ( options.showPeaks !== undefined )
			this.showPeaks = options.showPeaks;

		if ( options.showFPS !== undefined )
			this.showFPS = options.showFPS;

		if ( options.loRes !== undefined )
			this._loRes = options.loRes;

		if ( options.fftSize !== undefined )
			this.analyzer.fftSize = options.fftSize;

		if ( options.smoothing !== undefined )
			this.analyzer.smoothingTimeConstant = options.smoothing;

		if ( typeof options.onCanvasDraw == 'function' )
			this.onCanvasDraw = options.onCanvasDraw;

		if ( typeof options.onCanvasResize == 'function' )
			this.onCanvasResize = options.onCanvasResize;

		if ( options.width !== undefined )
			this._width = options.width;

		if ( options.height !== undefined )
			this._height = options.height;

		this._dataArray = new Uint8Array( this.analyzer.frequencyBinCount );

		this._setCanvas('user');

		if ( options.start !== undefined )
			this.toggleAnalyzer( options.start );
	}

	/**
	 * Adjust the analyzer's sensitivity
	 *
	 * @param {number} min minimum decibels value
	 * @param {number} max maximum decibels value
	 */
	setSensitivity( min, max ) {
		this.analyzer.minDecibels = Math.min( min, max );
		this.analyzer.maxDecibels = Math.max( min, max );
	}

	/**
	 * Start / stop canvas animation
	 *
	 * @param {boolean} [value] if undefined, inverts the current status
	 * @returns {boolean} resulting status after the change
	 */
	toggleAnalyzer( value ) {
		var started = this.isOn;
		if ( value === undefined )
			value = ! started;

		if ( started && ! value ) {
			cancelAnimationFrame( this._animationReq );
			this._animationReq = undefined;
		}
		else if ( ! started && value ) {
			this.frame = this._fps = 0;
			this.time = performance.now();
			this._animationReq = requestAnimationFrame( () => this._draw() );
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
			if ( this.canvas.requestFullscreen )
				this.canvas.requestFullscreen();
			else if ( this.canvas.webkitRequestFullscreen )
				this.canvas.webkitRequestFullscreen();
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
	 * Redraw the canvas
	 * this is called 60 times per second by requestAnimationFrame()
	 */
	_draw() {

		var i, j, l, bar, barHeight, size,
			isLedDisplay = ( this.showLeds && this._mode > 0 );

		if ( ! this.showBgColor )	// use black background
			this.canvasCtx.fillStyle = '#000';
		else
			if ( isLedDisplay )
				this.canvasCtx.fillStyle = '#111';
			else
				this.canvasCtx.fillStyle = this._gradients[ this.gradient ].bgColor; // use background color defined by gradient

		// clear the canvas
		this.canvasCtx.fillRect( 0, 0, this.canvas.width, this.canvas.height );

		// get a new array of data from the FFT
		this.analyzer.getByteFrequencyData( this._dataArray );

		l = this._analyzerBars.length;
		for ( i = 0; i < l; i++ ) {

			bar = this._analyzerBars[ i ];

			if ( bar.endIdx == 0 ) 	// single FFT bin
				barHeight = this._dataArray[ bar.dataIdx ];
			else { 					// range of bins
				barHeight = 0;
				if ( bar.average ) {
					// use the average value of the range
					for ( j = bar.dataIdx; j <= bar.endIdx; j++ )
						barHeight += this._dataArray[ j ];
					barHeight = barHeight / ( bar.endIdx - bar.dataIdx + 1 );
				}
				else {
					// use the highest value in the range
					for ( j = bar.dataIdx; j <= bar.endIdx; j++ )
						barHeight = Math.max( barHeight, this._dataArray[ j ] );
				}
			}

			if ( isLedDisplay ) // normalize barHeight to match one of the "led" elements
				barHeight = ( barHeight / 255 * this._ledOptions.nLeds | 0 ) * ( this._ledOptions.ledHeight + this._ledOptions.spaceV );
			else
				barHeight = barHeight / 255 * this.canvas.height | 0;

			if ( barHeight >= bar.peak ) {
				bar.peak = barHeight;
				bar.hold = 30; // set peak hold time to 30 frames (0.5s)
				bar.accel = 0;
			}

			this.canvasCtx.fillStyle = this._gradients[ this.gradient ].gradient;
			if ( isLedDisplay )
				this.canvasCtx.fillRect( bar.posX + this._ledOptions.spaceH / 2, this.canvas.height, this._barWidth, -barHeight );
			else
				this.canvasCtx.fillRect( bar.posX, this.canvas.height, this._barWidth, -barHeight );

			if ( bar.peak > 0 ) {
				if ( this.showPeaks )
					if ( isLedDisplay )
						this.canvasCtx.fillRect( bar.posX + this._ledOptions.spaceH / 2, ( this._ledOptions.nLeds - ( bar.peak / this.canvas.height * this._ledOptions.nLeds | 0 ) ) * ( this._ledOptions.ledHeight + this._ledOptions.spaceV ), this._barWidth, this._ledOptions.ledHeight );
					else
						this.canvasCtx.fillRect( bar.posX, this.canvas.height - bar.peak, this._barWidth, 2 );

				if ( bar.hold )
					bar.hold--;
				else {
					bar.accel++;
					bar.peak -= bar.accel;
				}
			}
		}

		if ( isLedDisplay ) // applies LEDs mask over the canvas
			this.canvasCtx.drawImage( this._ledsMask, 0, 0 );

		if ( this.showScale ) {
			size = 5 * this._pixelRatio;

			if ( this.isFullscreen )
				size *= 2;

			this.canvasCtx.fillStyle = '#000c';
			this.canvasCtx.fillRect( 0, this.canvas.height - size * 4, this.canvas.width, size * 4 );

			this.canvasCtx.fillStyle = '#fff';
			this.canvasCtx.font = ( size * 2 ) + 'px sans-serif';
			this.canvasCtx.textAlign = 'center';

			this._freqLabels.forEach( label => this.canvasCtx.fillText( label.freq, label.posX, this.canvas.height - size ) );
		}

		this.frame++;
		var now = performance.now();
		var elapsed = now - this.time;
		if ( elapsed >= 1000 ) {
			this._fps = this.frame / ( elapsed / 1000 );
			this.frame = 0;
			this.time = now;
		}
		if ( this.showFPS ) {
			size = 20 * this._pixelRatio;
			this.canvasCtx.font = `bold ${size}px sans-serif`;
			this.canvasCtx.fillStyle = '#0f0';
			this.canvasCtx.textAlign = 'right';
			this.canvasCtx.fillText( Math.round( this._fps ), this.canvas.width - size, size * 2 );
		}

		if ( this.onCanvasDraw )
			this.onCanvasDraw( this );

		// schedule next canvas update
		this._animationReq = requestAnimationFrame( () => this._draw() );
	}

	/**
	 * Generate gradients
	 */
	_generateGradients() {
		var grad, i;

		Object.keys( this._gradients ).forEach( key => {
			if ( this._gradients[ key ].dir && this._gradients[ key ].dir == 'h' )
				grad = this.canvasCtx.createLinearGradient( 0, 0, this.canvas.width, 0 );
			else
				grad = this.canvasCtx.createLinearGradient( 0, 0, 0, this.canvas.height );

			if ( this._gradients[ key ].colorStops ) {
				this._gradients[ key ].colorStops.forEach( ( colorInfo, index ) => {
					if ( typeof colorInfo == 'object' )
						grad.addColorStop( colorInfo.pos, colorInfo.color );
					else
						grad.addColorStop( index / ( this._gradients[ key ].colorStops.length - 1 ), colorInfo );
				});
			}

			this._gradients[ key ].gradient = grad; // save the generated gradient back into the gradients array
		});
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

		var i, freq,
			minLog = Math.log10( this._minFreq ),
			bandWidth = this.canvas.width / ( Math.log10( this._maxFreq ) - minLog );

		this._analyzerBars = [];

		if ( this._mode == 0 ) { // discrete frequencies mode
			this._barWidth = 1;

	 		var pos,
	 			lastPos = -1,
				minIndex = Math.floor( this._minFreq * this.analyzer.fftSize / this.audioCtx.sampleRate ),
			    maxIndex = Math.min( Math.round( this._maxFreq * this.analyzer.fftSize / this.audioCtx.sampleRate ), this.analyzer.frequencyBinCount - 1 );

			for ( i = minIndex; i <= maxIndex; i++ ) {
				freq = i * this.audioCtx.sampleRate / this.analyzer.fftSize; // frequency represented in this bin
				pos = Math.round( bandWidth * ( Math.log10( freq ) - minLog ) ); // avoid fractionary pixel values

				// if it's on a different X-coordinate, create a new bar for this frequency
				if ( pos > lastPos ) {
					this._analyzerBars.push( { posX: pos, dataIdx: i, endIdx: 0, average: false, peak: 0, hold: 0, accel: 0 } );
					lastPos = pos;
				} // otherwise, add this frequency to the last bar's range
				else if ( this._analyzerBars.length )
					this._analyzerBars[ this._analyzerBars.length - 1 ].endIdx = i;
			}
		}
		else { // octave bands modes

			var spaceV = Math.min( 6, this.canvas.height / ( 90 * this._pixelRatio ) | 0 ), // for modes 3, 4, 5 and 6
				groupnotes = this._mode; // for modes 1, 2, 3 and 4

			// calculates the best attributes for the LEDs effect, based on the visualization mode and canvas resolution

			switch ( this._mode ) {
				case 8:
					groupnotes = 24;
					spaceV = Math.min( 16, this.canvas.height / ( 33 * this._pixelRatio ) | 0 );
					this._ledOptions = {
						nLeds: 24,
						spaceH: Math.min( 24, this.canvas.width / ( 40 * this._pixelRatio ) | 0 )
					};
					break;

				case 7:
					groupnotes = 12;
					spaceV = Math.min( 8, this.canvas.height / ( 67 * this._pixelRatio ) | 0 );
					this._ledOptions = {
						nLeds: 48,
						spaceH: Math.min( 16, this.canvas.width / ( 60 * this._pixelRatio ) | 0 )
					};
					break;

				case 6:
					groupnotes = 8;
					this._ledOptions = {
						nLeds: 64,
						spaceH: Math.min( 10, this.canvas.width / ( 96 * this._pixelRatio ) | 0 )
					};
					break;

				case 5:
					groupnotes = 6;
				case 4:
					this._ledOptions = {
						nLeds: 80,
						spaceH: Math.min( 8, this.canvas.width / ( 120 * this._pixelRatio ) | 0 )
					};
					break;

				case 3:
					this._ledOptions = {
						nLeds: 96,
						spaceH: Math.min( 6, this.canvas.width / ( 160 * this._pixelRatio ) | 0 )
					};
					break;

				case 2:
					spaceV = Math.min( 4, this.canvas.height / ( 135 * this._pixelRatio ) | 0 );
					this._ledOptions = {
						nLeds: 128,
						spaceH: Math.min( 4, this.canvas.width / ( 240 * this._pixelRatio ) | 0 )
					};
					break;

				default:
					this._mode = groupnotes = 1; // convert any invalid mode to mode 1
					spaceV = Math.min( 3, Math.max( 2, this.canvas.height / ( 180 * this._pixelRatio ) | 0 ) );
					this._ledOptions = {
						nLeds: 128,
						spaceH: Math.min( 4, this.canvas.width / ( 320 * this._pixelRatio ) | 0 )
					};
			}

			this._ledOptions.spaceH *= this._pixelRatio;
			this._ledOptions.spaceV = spaceV * this._pixelRatio;
			this._ledOptions.nLeds = Math.min( this._ledOptions.nLeds, this.canvas.height / ( this._ledOptions.spaceV * 2 ) | 0 );
			this._ledOptions.ledHeight = this.canvas.height / this._ledOptions.nLeds - this._ledOptions.spaceV;

			// generate a table of frequencies based on the equal tempered scale
			var root24 = 2 ** ( 1 / 24 ); // for 1/24th-octave bands
			var c0 = 440 * root24 ** -114;
			var temperedScale = [];
			var prevBin = 0;

			i = 0;
			while ( ( freq = c0 * root24 ** i ) <= this._maxFreq ) {
				if ( freq >= this._minFreq && i % groupnotes == 0 )
					temperedScale.push( freq );
				i++;
			}

			// divide canvas space by the number of frequencies to display, allowing at least one pixel between bars
			this._barWidth = Math.floor( this.canvas.width / temperedScale.length ) - 1;

			// the space remaining from the integer division is split equally among the bars as separator
			var barSpace = ( this.canvas.width - this._barWidth * temperedScale.length ) / ( temperedScale.length - 1 );

			this._ledsMask.width |= 0; // clear LEDs mask canvas

			temperedScale.forEach( ( freq, index ) => {
				// which FFT bin represents this frequency?
				var bin = Math.round( freq * this.analyzer.fftSize / this.audioCtx.sampleRate );

				var idx, nextBin, avg = false;
				// start from the last used FFT bin
				if ( prevBin > 0 && prevBin + 1 <= bin )
					idx = prevBin + 1;
				else
					idx = bin;

				prevBin = nextBin = bin;
				// check if there's another band after this one
				if ( temperedScale[ index + 1 ] !== undefined ) {
					nextBin = Math.round( temperedScale[ index + 1 ] * this.analyzer.fftSize / this.audioCtx.sampleRate );
					// and use half the bins in between for this band
					if ( nextBin - bin > 1 )
						prevBin += Math.round( ( nextBin - bin ) / 2 );
					else if ( nextBin - bin == 1 ) {
					// for low frequencies the FFT may not provide as many coefficients as we need, so more than one band will use the same FFT data
					// in these cases, we set a flag to perform an average to smooth the transition between adjacent bands
						if ( this._analyzerBars.length > 0 && idx == this._analyzerBars[ this._analyzerBars.length - 1 ].dataIdx ) {
							avg = true;
							prevBin += Math.round( ( nextBin - bin ) / 2 );
						}
					}
				}

				this._analyzerBars.push( {
					posX: index * ( this._barWidth + barSpace ),
					dataIdx: idx,
					endIdx: prevBin - idx > 0 ? prevBin : 0,
					average: avg,
					peak: 0,
					hold: 0,
					accel: 0
				} );

				// adds a vertical black line to the left of this bar in the mask canvas, to separate the LED columns
				this._ledsCtx.fillRect( this._analyzerBars[ this._analyzerBars.length - 1 ].posX - this._ledOptions.spaceH / 2, 0, this._ledOptions.spaceH, this.canvas.height );

			} );
		}

		if ( this._mode > 0 ) {
			// adds a vertical black line in the mask canvas after the last led column
			this._ledsCtx.fillRect( this._analyzerBars[ this._analyzerBars.length - 1 ].posX + this._barWidth - this._ledOptions.spaceH / 2 + ( this._mode < 5 ? 2 : 1 ), 0, this._ledOptions.spaceH, this.canvas.height );

			// adds horizontal black lines in the mask canvas, to separate the LED rows
			for ( i = this._ledOptions.ledHeight; i < this.canvas.height; i += this._ledOptions.ledHeight + this._ledOptions.spaceV )
				this._ledsCtx.fillRect( 0, i, this.canvas.width, this._ledOptions.spaceV );
		}

		// calculate the position of the labels (octaves center frequencies) for the X-axis scale
		this._freqLabels = [
			{ freq: 16 },
			{ freq: 31 },
			{ freq: 63 },
			{ freq: 125 },
			{ freq: 250 },
			{ freq: 500 },
			{ freq: 1000 },
			{ freq: 2000 },
			{ freq: 4000 },
			{ freq: 8000 },
			{ freq: 16000 }
		];

		this._freqLabels.forEach( label => {
			label.posX = bandWidth * ( Math.log10( label.freq ) - minLog );
			if ( label.freq >= 1000 )
				label.freq = ( label.freq / 1000 ) + 'k';
		});
	}


	/**
	 * Internal function to change canvas dimensions on demand
	 */
	_setCanvas( reason ) {
		this._pixelRatio = window.devicePixelRatio; // for Retina / HiDPI devices

		if ( this._loRes )
			this._pixelRatio /= 2;

		this._fsWidth = Math.max( window.screen.width, window.screen.height ) * this._pixelRatio;
		this._fsHeight = Math.min( window.screen.height, window.screen.width ) * this._pixelRatio;

		if ( this.isFullscreen ) {
			this.canvas.width = this._fsWidth;
			this.canvas.height = this._fsHeight;
		}
		else {
			this.canvas.width = ( this._width || this._container.clientWidth || this._defaults.width ) * this._pixelRatio;
			this.canvas.height = ( this._height || this._container.clientHeight || this._defaults.height ) * this._pixelRatio;
		}

		// workaround for wrong dPR reported on Android TV
		if ( this._pixelRatio == 2 && window.screen.height <= 540 )
			this._pixelRatio = 1;

		// clear the canvas
		this.canvasCtx.fillStyle = '#000';
		this.canvasCtx.fillRect( 0, 0, this.canvas.width, this.canvas.height );

		// (re)generate gradients
		this._generateGradients();

		// create an auxiliary canvas for the LED effect mask
		this._ledsMask = this.canvas.cloneNode();
		this._ledsCtx = this._ledsMask.getContext('2d');
		this._ledsCtx.fillStyle = '#000';

		this._precalculateBarPositions();

		if ( this.onCanvasResize )
			this.onCanvasResize( reason, this );
	}

}