import MapKit
import React

final class NaviMapView: MKMapView, MKMapViewDelegate {
  @objc var mapData: NSString = "{}" {
    didSet { renderMapData() }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    delegate = self
    mapType = .standard
    pointOfInterestFilter = .excludingAll
    isAccessibilityElement = false
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private func coordinate(_ value: Any?) -> CLLocationCoordinate2D? {
    guard let point = value as? [String: Any],
          let latitude = point["latitude"] as? NSNumber,
          let longitude = point["longitude"] as? NSNumber else { return nil }
    let result = CLLocationCoordinate2D(latitude: latitude.doubleValue, longitude: longitude.doubleValue)
    return CLLocationCoordinate2DIsValid(result) ? result : nil
  }

  private func renderMapData() {
    guard let data = (mapData as String).data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    removeAnnotations(annotations)
    removeOverlays(overlays)
    var coordinates: [CLLocationCoordinate2D] = []
    if let position = coordinate(json["position"]) {
      let marker = MKPointAnnotation(); marker.coordinate = position; marker.title = "Current position"
      addAnnotation(marker); coordinates.append(position)
    }
    if let destination = coordinate(json["destination"]) {
      let marker = MKPointAnnotation(); marker.coordinate = destination; marker.title = "Destination"
      addAnnotation(marker); coordinates.append(destination)
    }
    if let route = json["route"] as? [Any] {
      let points = route.compactMap { coordinate($0) }
      coordinates.append(contentsOf: points)
      if points.count >= 2 {
        var mutable = points
        addOverlay(MKPolyline(coordinates: &mutable, count: mutable.count))
      }
    }
    guard !coordinates.isEmpty else { return }
    if coordinates.count == 1 {
      setRegion(MKCoordinateRegion(center: coordinates[0],
        latitudinalMeters: 900, longitudinalMeters: 900), animated: false)
    } else {
      var rect = MKMapRect.null
      for point in coordinates {
        rect = rect.union(MKMapRect(origin: MKMapPoint(point), size: MKMapSize(width: 0, height: 0)))
      }
      setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 50, left: 40, bottom: 50, right: 40), animated: false)
    }
  }

  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    guard let polyline = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
    let renderer = MKPolylineRenderer(polyline: polyline)
    renderer.strokeColor = UIColor(red: 0.02, green: 0.72, blue: 0.86, alpha: 1)
    renderer.lineWidth = 6
    renderer.lineCap = .round
    return renderer
  }
}

@objc(NaviMapViewManager)
final class NaviMapViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func view() -> UIView! { NaviMapView() }
}
