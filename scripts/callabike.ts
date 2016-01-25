/// <reference path="../typings/zepto/zepto.d.ts" />
/// <reference path="../typings/ol/ol.d.ts" />

module CallABike {
    export enum Events {
        Clock,
        LoadedChunk,
        ClickedBike
    }
    
    // allow other classes to listen for events
    export class EventBus {
        private events = Array();
        public on(event: Events, action: Function) {
            if (!this.events[event]) this.events[event] = Array();
            this.events[event].push(action);
        }

        public trigger(event: Events, param?: any) {
            if (!this.events[event]) return;
            this.events[event].forEach((f) => {
                f(param);
            });
        }
    }

    export class Application extends EventBus {
        public drawLines = true; // draw trace lines on map
        public drawMarkers = true; // draw & move markers on map
        public speed: number = 100; // render loop interval
        public stepSize = 15; // clock step

        public mapEngine: MapEngine

        public ticks: number = Math.max(1, Math.round(this.speed / 2)); // render move as steps to smoothen movement

        private intervalHandle = -1; // runner loop interval handle
        public _counter: number = 0;
        public lastCounter = -1; // contains timestamp of last datapoint

        // icon style for map markers
        public markerMovingStyle = new ol.style.Style({
            image: new ol.style.Icon({
                anchor: [0.5, 1],
                anchorXUnits: 'fraction',
                anchorYUnits: 'fraction',
                opacity: 0.75,
                scale: .9,
                src: './assets/bikeIcon.png'
            })
        });

        // hide marker when not in use
        public markerStoppedStyle = new ol.style.Style({});

        public set counter(val: number) { // inernal clock
            this._counter = val;

            // load new data once close to end
            if (this.dataFiles.length > 0 && this._counter + (10 * app.stepSize * (1000 / app.speed)) >= this.dataFiles[0].startTime) {
                this.loadNextChunk();
            }

            // stop runner once past last datapoint
            if (this.counter >= this.lastCounter && this.lastCounter > 0) this.stop();
        }

        public get counter(): number {
            return this._counter;
        }

        // holds the uris of the availiable datafiles
        private dataFiles = [];

        constructor() {
            super();
            this.mapEngine = new MapEngine();
        }

        // Do an initial load of the entry file.
        public loadData() {
            $.ajax({
                url: 'data/data.json',
                dataType: 'json',
                success: (data) => {
                    this.dataFiles = data.timeChunks;
                    this.counter = this.dataFiles[0].startTime - this.stepSize - 1;
                    this.loadNextChunk();
                }
            });
        }

        // load the next data chunk
        private loadNextChunk() {
            if (this.dataFiles.length == 0) return;
            var chunk = this.dataFiles.shift();
            if (this.dataFiles.length == 0) this.lastCounter = chunk.lastTime;

            $.ajax({
                url: 'data/' + chunk.fileName,
                dataType: 'json',
                success: (data) => {
                    data.bikes.forEach((b) => {
                        BikeManager.loadBike(b.id, b);
                    });
                    this.trigger(Events.LoadedChunk, name);
                }
            });
        }

        // clock function
        private runner() {
            BikeManager.getBikes().forEach(function(bike: Bike) {
                // wakeup bike once its time
                if (bike.nextWakeupTime <= app.counter && bike.nextWakeupTime > 0 && !bike.isMoving()) {
                    bike.wakeup(app.counter);
                }
            });

            this.counter = this.counter + app.stepSize; // increase clock
            this.trigger(Events.Clock, this.timeConverter(this.counter));
        }

        // start clock
        public start() {
            if (this.intervalHandle > 0) return;
            this.runner();
            this.intervalHandle = setInterval(this.runner.bind(this), this.speed);
        }

        // stop clock
        public stop() {
            if (this.intervalHandle < 0) return;
            clearInterval(this.intervalHandle);
            this.intervalHandle = -1;
        }

        // prune entries older than given time
        public prune(time: number) {
            BikeManager.getBikes().forEach((bike) => bike.prune(time));
        }

        // clear trace lines
        public clearLines() {
            this.mapEngine.traceSource.clear();
        }

        private timeConverter(UNIX_timestamp: number): Date {
            return new Date(UNIX_timestamp * 1000);
        }

        // pad number to specific width
        private pad(n, width, z?): string {
            z = z || '0';
            n = n + '';
            return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
        }
    }

    export class Marker {
        public olMarker;
        public lonLat: LonLat;

        private timer: number;
        public isMoving = false;
        private isHidden = null;

        private bike: Bike;
        private lineString;

        private iconStyle = app.markerMovingStyle;
        private hiddenStyle = app.markerStoppedStyle;


        constructor(bike: Bike, lonlat: LonLat) {
            this.bike = bike;
            this.lonLat = lonlat;

            this.olMarker = new ol.Feature({
                geometry: new ol.geom.Point(lonlat.getOL()),
                bike: this.bike
            });
            
            // set as initially hidden
            this.hide();

            // attach to map
            if (app.drawMarkers) {
                app.mapEngine.addMarker(this);
            }

            if (app.drawLines) {
                this.lineString = new ol.Feature({
                    geometry: new ol.geom.LineString([lonlat.getOL()])
                });
                app.mapEngine.traceSource.addFeature(this.lineString);
            }

        }


        public hide() {
            if (this.isHidden) return;
            this.olMarker.setStyle(this.hiddenStyle);
            this.isHidden = true;
        }

        public show() {
            if (!this.isHidden) return;

            /*
            // load random avatar instead of bike icon

            $.ajax({
                url: 'http://uifaces.com/api/v1/random?cacheString=' + this.bike.id, dataType: 'json', success: (data) => {
                    var url = (data.image_urls.mini);
                    this.olMarker.setStyle(new ol.style.Style({
                        image: new ol.style.Icon({
                            anchor: [0.5, 1],
                            anchorXUnits: 'fraction',
                            anchorYUnits: 'fraction',
                            opacity: 0.75,
                            scale: .9,
                            src: url
                        })
                    }));
                }
            });*/
            this.olMarker.setStyle(this.iconStyle);
            this.isHidden = false;
        }


        public move(target: LonLat, duration: number) {
            if (this.isMoving) return false;
            this.isMoving = true;


            // calculate delta move
            var pos = this.lonLat.getOL();
            var deltaX = target.getOL()[0] - pos[0];
            var deltaY = target.getOL()[1] - pos[1];

            var ticks = app.ticks;
            var pixelTicker = 0;


            if (app.drawLines) {
                // add new point to linestring, gets moved later in render loop
                var coords = this.lineString.getGeometry().getCoordinates();
                coords.push(pos);
            }

            // do not animate an instant move, or with fast enough clock speeds
            if (duration == 0 || app.speed == 1) {
                this.isMoving = false;
                if (app.drawMarkers) {
                    this.olMarker.getGeometry().setCoordinates(target.getOL());
                }
                if (app.drawLines) {
                    coords[coords.length - 1] = [pos[0] + deltaX, pos[1] + deltaY]; // set last line coordinate to new position
                    this.lineString.getGeometry().setCoordinates(coords);
                }
                this.lonLat = target;
                return;
            } else {
                // smooth move render loop
                this.timer = window.setInterval(() => {
                    if (++pixelTicker > ticks) {
                        clearInterval(this.timer);
                        this.isMoving = false;
                        this.lonLat = target;
                        return;
                    }

                    // move marker
                    if (app.drawMarkers) {
                        this.olMarker.getGeometry().setCoordinates([pos[0] + (pixelTicker / ticks) * deltaX, pos[1] + (pixelTicker / ticks) * deltaY]);
                    }
                    // move line string
                    if (app.drawLines) {
                        coords[coords.length - 1] = [pos[0] + (pixelTicker / ticks) * deltaX, pos[1] + (pixelTicker / ticks) * deltaY];
                        this.lineString.getGeometry().setCoordinates(coords);
                    }

                }, ((duration) * app.speed / app.stepSize) / ticks);
            }
        }
    }

    // class that transforms projections
    // TODO: already do on server side
    export class LonLat {
        private olLonLat = null;
        public lng: number;
        public lat: number;

        constructor(lng: number, lat: number) {
            this.olLonLat = ol.proj.transform([lng, lat], 'EPSG:4326', 'EPSG:3857');
        }

        getOL() {
            return this.olLonLat;
        }
    }

    export class MapEngine {
        public map;
        private markers;
        private routes;


        public markerSource;
        public traceSource;

        private markerLayer
        private rasterLayer;
        private traceLayer;

        constructor() {

            // sources will contain markers, linestrings
            this.traceSource = new ol.source.Vector();
            this.markerSource = new ol.source.Vector();

            this.markerLayer = new ol.layer.Vector({
                source: this.markerSource
            });
            this.traceLayer = new ol.layer.Vector({
                source: this.traceSource
            });

            // load mapbox tile set
            this.rasterLayer = new ol.layer.Tile({
                source: new ol.source.TileJSON({
                    url: 'http://api.tiles.mapbox.com/v3/gregod.ij34179i.jsonp',
                    crossOrigin: 'anonymous'
		   })
            });

            this.map = new ol.Map({
                layers: [this.rasterLayer, this.traceLayer, this.markerLayer],
                target: document.getElementById('map'), // TODO: Extract into property/constructor
                controls: [ new ol.control.Attribution()],
                // center on munich
                view: new ol.View({
                    center: new LonLat(11.574599, 48.132988).getOL(),
                    zoom: 13
                })
            });

            // trigger bike klicks
            this.map.on('click', (evt) => {
                var feature = this.map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => feature);
                if (feature && feature.get("bike")) {
                    app.trigger(Events.ClickedBike, feature.get("bike"));
                }
            });

        }


        addMarker(marker: Marker) {
            this.markerSource.addFeature(marker.olMarker);
        }

        // allow changing the visibility of layers
        
        public setVisibilityMarkers(status: boolean) {
            this.markerLayer.setVisible(status);
        }

        public setVisibilityTraces(status: boolean) {
            this.traceLayer.setVisible(status);
        }

        public setVisibilityTiles(status: boolean) {
            this.rasterLayer.setVisible(status);
        }
    }
    
    export class MoveHistory {
        public movements: Movement[] = Array();
        private counterMovement = 0;
        private counterWaypoint = 0;

        constructor(movements) {
            this.addMovements(movements);
        }

        public addMovements(movements) {
            for (var k = 0; k < movements.length; k++) {
                if (movements[k] == null) continue;
                this.movements.push(new Movement(movements[k]));
            }
        }

        public getNextWakeup(): number {
            if (this.hasFinishedHistory()) return -1;
            return this.movements[this.counterMovement].startTime;
        }

        // is current waypoint the first in a movement
        public isFirstWaypoint(): boolean {
            return (this.counterWaypoint == 1);
        }

        public hasFinishedHistory(): boolean {
            return (this.movements.length <= this.counterMovement);
        }


        // return next waypoint without removing it from queue
        public peekNextWaypoint(): Waypoint {
            if (this.hasFinishedHistory()) return null;
            return this.movements[this.counterMovement].waypoints[this.counterWaypoint];

        }

        // return next waypoint and remove it from queue
        public getNextWaypoint(): Waypoint {

            if (this.hasFinishedHistory()) return null;

            var waypoint = this.movements[this.counterMovement].waypoints[this.counterWaypoint];
            this.counterWaypoint++;
            
            // move to next movement after last waypoint
            if (this.movements[this.counterMovement].waypoints.length <= this.counterWaypoint) {
                this.counterMovement++;
                this.counterWaypoint = 0;
            }

            return waypoint;
        }
    }

    export class Movement {
        public startTime: number;
        public endTime: number;
        public duration: number;
        public waypoints: Waypoint[] = Array();

        constructor(data) {
            this.startTime = data.from.time;
            this.endTime = data.to.time;
            this.duration = data.duration;
            for (var l = 0; l < data.waypoints.length; l++) {
                this.waypoints.push(new Waypoint(data.waypoints[l]));
            }
        }



    }

    export class Waypoint {
        public lonLat: LonLat;
        public time: number;
        constructor(data) {
            this.time = data.time;
            this.lonLat = new LonLat(data.lng, data.lat);
        }
    }



    export class Bike {
        public id;
        private marker: Marker;
        private timer;
        public nextWakeupTime: number;
        public moves: MoveHistory;

        constructor(id: number, movements: Array<any>) {
            this.id = id;
            this.moves = new MoveHistory(movements);
            this.nextWakeupTime = this.moves.getNextWakeup();
        }

        public isMoving() {
            if (!this.marker) return false;
            return this.marker.isMoving;
        }

        // remove old waypoints
        public prune(time: number) {
            var next = this.moves.peekNextWaypoint();
            while (next && next.time < time) {
                this.moves.getNextWaypoint();
                next = this.moves.peekNextWaypoint();
            }
        }

        // wake up gets called by runner loop
        public wakeup(time: number, catchUp?: boolean) {
            catchUp = catchUp || false; // if catchup required -> do instant move 
            if (this.moves.hasFinishedHistory()) {
                this.nextWakeupTime = -1;
                this.marker.hide();
                return;
            }

            var currentMove = this.moves.getNextWaypoint()
            if (currentMove == null) return;

            // create bike marker on first wakeup
            if (this.marker == null) {
                this.nextWakeupTime = currentMove.time;
                this.marker = new Marker(this, currentMove.lonLat);
                this.marker.show();
                return;
            }

            // do a catchup move if we are behind clock
            var peek = this.moves.peekNextWaypoint();
            if (peek && peek.time <= time) {
                return this.wakeup(peek.time, true);
            }

            var duration = currentMove.time - this.nextWakeupTime;
            if (catchUp) duration = 0; // do instant move on catchup
            this.nextWakeupTime = currentMove.time;

            // if next move is first of movement (this one ist last) -> Move marker to position and hide.
            if (this.moves.isFirstWaypoint()) {
                this.marker.hide();
                this.marker.move(currentMove.lonLat, 0);
            } else {
                this.marker.show();
                this.marker.move(currentMove.lonLat, duration);
            }

        }
    }


    export class BikeManager {
        private static bikes: Array<Bike> = [];

        // returns Bike object from internal store; if id is allready in use -> merge new move data
        static loadBike(id: number, data?): Bike {

            if (data && this.bikes[id]) this.bikes[id].moves.addMovements(data.movements);
            if (!this.bikes[id]) this.bikes[id] = new Bike(id, data.movements);

            return this.bikes[id];
        }
        // returns all bikes from internal store
        static getBikes(): Array<Bike> {
            return this.bikes;
        }

    }

    export var app = new Application();
}
