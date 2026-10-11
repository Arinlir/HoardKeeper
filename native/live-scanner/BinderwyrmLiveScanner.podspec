require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Only used if the iOS project is ever switched to CocoaPods; the default
# (Capacitor 8) is Swift Package Manager, via Package.swift.
Pod::Spec.new do |s|
  s.name = 'BinderwyrmLiveScanner'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/Arinlir/HoardKeeper'
  s.author = 'Arinlir'
  s.source = { :git => 'https://github.com/Arinlir/HoardKeeper.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.frameworks = 'AVFoundation', 'Vision'
  s.swift_version = '5.9'
end
