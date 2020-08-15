function isMobile() {
    return /Android|mobile|iPad|iPhone/i.test(navigator.userAgent);
}

var interpolationFactor = 24;

var trackedMatrix = {
  // for interpolation
  delta: [
      0,0,0,0,
      0,0,0,0,
      0,0,0,0,
      0,0,0,0
  ],
  interpolated: [
      0,0,0,0,
      0,0,0,0,
      0,0,0,0,
      0,0,0,0
  ]
}

var markers = {
    "alterra": {
      width: 750,
      height: 563,
      dpi: 150,
      url: "../../trackables/Alterra_Ticket_1",
  },
};

var setMatrix = function (matrix, value) {
    var array = [];
    for (var key in value) {
        array[key] = value[key];
    }
    if (typeof matrix.elements.set === "function") {
        matrix.elements.set(array);
    } else {
        matrix.elements = [].slice.call(array);
    }
};

//var worker;
function start(container, marker, video, input_width, input_height, canvas_draw, render_update, track_update) {
    worker = new Worker('./src/wasm_worker/artoolkit.wasm_worker.js');
    worker.onmessage = function(ev) {
        start2(container, marker, video, input_width, input_height, canvas_draw, render_update, track_update);
    }
}

function start2(container, marker, video, input_width, input_height, canvas_draw, render_update, track_update) {
    var vw, vh;
    var sw, sh;
    var pscale, sscale;
    var w, h;
    var pw, ph;
    var ox, oy;
    var camera_para = '../../data/camera_para.dat'
    var cameraMatrix = {}

    var canvas_process = document.createElement('canvas');
    var context_process = canvas_process.getContext('2d');

    var renderer = new THREE.WebGLRenderer({canvas: canvas_draw, alpha: true, antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);

    var scene = new THREE.Scene();

    var camera = new THREE.Camera();
    camera.matrixAutoUpdate = false;

    scene.add(camera);

    var sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 8),
        new THREE.MeshNormalMaterial()
    );

    var root = new THREE.Object3D();
    scene.add(root);

    sphere.material.flatShading;
    sphere.position.z = 0;
    sphere.position.x = 100;
    sphere.position.y = 100;
    sphere.scale.set(200, 200, 200);

    root.matrixAutoUpdate = false;
    var axesHelper = new THREE.AxesHelper( 50 );
    root.add( axesHelper );    
    root.add(sphere);

    var resize = function() {
      vw = video.videoWidth;
      vh = video.videoHeight;

      pscale = 320 / Math.max(vw, vh / 3 * 4);
      sscale = isMobile() ? window.outerWidth / input_width : 1;

      sw = vw * sscale;
      sh = vh * sscale;
      w = vw * pscale;
      h = vh * pscale;
      pw = Math.max(w, h / 3 * 4);
      ph = Math.max(h, w / 4 * 3);
      ox = (pw - w) / 2;
      oy = (ph - h) / 2;
      canvas_process.style.clientWidth = pw + "px";
      canvas_process.style.clientHeight = ph + "px";
      canvas_process.width = pw;
      canvas_process.height = ph;

      renderer.setSize(vw, vh);

      //Update camera matrix
      if (cameraMatrix) {
        var ratioW = pw / w;
        var ratioH = ph / h;
        var proj = {}
        Object.assign(proj, cameraMatrix)
        proj[0] *= ratioW;
        proj[4] *= ratioW;
        proj[8] *= ratioW;
        proj[12] *= ratioW;
        proj[1] *= ratioH;
        proj[5] *= ratioH;
        proj[9] *= ratioH;
        proj[13] *= ratioH;
        setMatrix(camera.projectionMatrix, proj);
      }
    }

    var load = function() {
        vw = input_width;
        vh = input_height;

        pscale = 320 / Math.max(vw, vh / 3 * 4);
        sscale = isMobile() ? window.outerWidth / input_width : 1;

        sw = vw * sscale;
        sh = vh * sscale;
        w = vw * pscale;
        h = vh * pscale;
        pw = Math.max(w, h / 3 * 4);
        ph = Math.max(h, w / 4 * 3);
        ox = (pw - w) / 2;
        oy = (ph - h) / 2;
        canvas_process.style.clientWidth = pw + "px";
        canvas_process.style.clientHeight = ph + "px";
        canvas_process.width = pw;
        canvas_process.height = ph;

        renderer.setSize(vw, vh);

        worker.postMessage({type: "load", pw: pw, ph: ph, camera_para: camera_para, marker: marker.url});

        worker.onmessage = function(ev) {
            var msg = ev.data;
            switch (msg.type) {
                case "loaded": {
                    var proj = JSON.parse(msg.proj);
                    Object.assign(cameraMatrix, proj)
                    var ratioW = pw / w;
                    var ratioH = ph / h;
                    proj[0] *= ratioW;
                    proj[4] *= ratioW;
                    proj[8] *= ratioW;
                    proj[12] *= ratioW;
                    proj[1] *= ratioH;
                    proj[5] *= ratioH;
                    proj[9] *= ratioH;
                    proj[13] *= ratioH;
                    setMatrix(camera.projectionMatrix, proj);
                    break;
                }

                case "endLoading": {
                  if (msg.end == true)
                    // removing loader page if present
                    document.body.classList.remove("loading");
                    document.getElementById("loading").remove();
                  break;
                }

                case "found": {
                    found(msg);
                    break;
                }

                case "not found": {
                    found(null);
                    break;
                }
            }

            track_update();
            process();
        };
    };

    var world;

    var found = function(msg) {
      if (!msg) {
        world = null;
      } else {
        world = JSON.parse(msg.matrixGL_RH);
      }
    };

    var lasttime = Date.now();
    var time = 0;

    var draw = function() {
        render_update();
        var now = Date.now();
        var dt = now - lasttime;
        time += dt;
        lasttime = now;

        if (!world) {
            sphere.visible = false;
            axesHelper.visible = false;

        } else {
          axesHelper.visible = true;
          // interpolate matrix
          for (var i = 0; i < 16; i++) {
            trackedMatrix.delta[i] = world[i] - trackedMatrix.interpolated[i];
            trackedMatrix.interpolated[i] =
              trackedMatrix.interpolated[i] +
              trackedMatrix.delta[i] / interpolationFactor;
          }

          // set matrix of 'root' by detected 'world' matrix
          setMatrix(root.matrix, trackedMatrix.interpolated);
        }
        renderer.render(scene, camera);
    };

    function process() {
      // only resize if videoWith changes -> if phone was rotated
      if(video.videoWidth != vw) {
        resize();
      }
      context_process.fillStyle = "black";
      context_process.fillRect(0, 0, pw, ph);
      context_process.drawImage(video, 0, 0, vw, vh, ox, oy, w, h);

      var imageData = context_process.getImageData(0, 0, pw, ph);
      worker.postMessage({ type: "process", imagedata: imageData }, [
        imageData.data.buffer
      ]);
    }
    var tick = function() {
        draw();
        requestAnimationFrame(tick);
    };

    load();
    tick();
    process();
}
