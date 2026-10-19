Pod::Spec.new do |s|
  s.name           = 'BsNative'
  s.version        = '1.0.0'
  s.summary        = 'BaseSecrète native crypto'
  s.description    = 'Argon2id, hardware-bound device key and monotonic clock for BaseSecrète.'
  s.license        = 'UNLICENSED'
  s.author         = 'BaseSecrète'
  s.homepage       = 'https://example.invalid/basesecrete'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Swift wrapper around the Argon2 reference implementation (P-H-C).
  s.dependency 'Argon2Swift', '1.0.4'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
