#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <SafariServices/SafariServices.h>
#import <GoogleCast/GoogleCast.h>
#import <Network/Network.h>
#import <AVKit/AVKit.h>
#import <AVFoundation/AVFoundation.h>
#import <math.h>
#import "VWReceiverProbe.h"

typedef void (^VWReply)(id value, NSString *error, NSString *name);
typedef void (^VWEvent)(NSDictionary *event);
static NSString *const VWOrigin = @"https://virtualwalking-iphone-bluefy.saltychick64.chatgpt.site/";
static NSString *const VWYouTubeReceiver = @"233637DE";
static NSString *VWString(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }
static NSString *VWUUID(CBUUID *uuid) {
    NSString *value = uuid.UUIDString.lowercaseString;
    return value.length == 4 ? [NSString stringWithFormat:@"0000%@-0000-1000-8000-00805f9b34fb", value] : value;
}

@interface VWPicker : UITableViewController
@property(nonatomic, strong) NSMutableArray<CBPeripheral *> *devices;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *names;
@property(nonatomic, copy) void (^selected)(CBPeripheral *);
@end
@implementation VWPicker
- (instancetype)init { if ((self = [super initWithStyle:UITableViewStyleInsetGrouped])) self.devices = [NSMutableArray new]; return self; }
- (void)viewDidLoad {
    [super viewDidLoad]; self.title = @"FTMS-Laufband auswählen";
    self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemCancel target:self action:@selector(cancel)];
    UILabel *hint = [UILabel new]; hint.text = @"Suche nach Laufbändern in der Nähe …"; hint.numberOfLines = 0; hint.textAlignment = NSTextAlignmentCenter; self.tableView.backgroundView = hint;
}
- (void)cancel { if (self.selected) self.selected(nil); }
- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section { return self.devices.count; }
- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)path {
    UITableViewCell *cell = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:nil];
    CBPeripheral *device = self.devices[path.row]; cell.textLabel.text = self.names[device.identifier.UUIDString] ?: device.name ?: @"Unbenanntes FTMS-Laufband"; cell.detailTextLabel.text = @"Bluetooth FTMS"; return cell;
}
- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)path { if (self.selected) self.selected(self.devices[path.row]); }
@end

// Transport adapter only. FTMS procedures and start interlocks remain in bluetooth.js.
@interface VWBLE : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate>
@property(nonatomic, weak) UIViewController *presenter;
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) CBPeripheral *peripheral;
@property(nonatomic, strong) CBService *service;
@property(nonatomic, strong) VWPicker *picker;
@property(nonatomic, strong) NSMutableDictionary<NSString *, CBCharacteristic *> *channels;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *names;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *pending;
@property(nonatomic, assign) NSUInteger generation;
@property(nonatomic, assign) NSUInteger serial;
@property(nonatomic, copy) VWEvent emit;
- (void)handle:(NSString *)method params:(NSDictionary *)params reply:(VWReply)reply;
- (void)close;
@end
@implementation VWBLE
- (instancetype)init { if ((self = [super init])) { self.channels = [NSMutableDictionary new]; self.pending = [NSMutableDictionary new]; self.names = [NSMutableDictionary new]; } return self; }
- (void)finish:(NSString *)key value:(id)value error:(NSString *)error name:(NSString *)name {
    NSDictionary *item = self.pending[key]; if (!item) return;
    [self.pending removeObjectForKey:key]; VWReply reply = item[@"reply"]; reply(value, error, name);
}
- (void)store:(NSString *)key reply:(VWReply)reply seconds:(NSInteger)seconds {
    NSUInteger ticket = ++self.serial; self.pending[key] = @{@"reply":[reply copy], @"ticket":@(ticket)};
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, seconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        typeof(self) self = weakSelf; if (!self || [self.pending[key][@"ticket"] unsignedIntegerValue] != ticket) return;
        [self finish:key value:nil error:@"Bluetooth hat nicht rechtzeitig geantwortet." name:@"NetworkError"];
        if ([key isEqualToString:@"choose"]) { [self.central stopScan]; [self.picker dismissViewControllerAnimated:YES completion:nil]; self.picker = nil; }
        if ([key isEqualToString:@"connect"]) [self close];
    });
}
- (void)close {
    CBPeripheral *device = self.peripheral; NSUInteger generation = self.generation;
    [self.central stopScan]; device.delegate = nil;
    if (device) [self.central cancelPeripheralConnection:device];
    self.peripheral = nil; self.service = nil; [self.channels removeAllObjects];
    for (NSString *key in self.pending.allKeys) [self finish:key value:nil error:@"Bluetooth-Verbindung getrennt." name:@"NetworkError"];
    if (device && self.emit) self.emit(@{@"type":@"ble.disconnected",@"deviceId":device.identifier.UUIDString,@"generation":@(generation)});
}
- (void)scan {
    if (self.picker && self.central.state == CBManagerStatePoweredOn) [self.central scanForPeripheralsWithServices:@[[CBUUID UUIDWithString:@"1826"]] options:nil];
}
- (void)handle:(NSString *)method params:(NSDictionary *)params reply:(VWReply)reply {
    if ([method isEqualToString:@"ble.choose"]) {
        if (self.picker) { reply(nil,@"Geräteauswahl läuft bereits.",@"InvalidStateError"); return; }
        [self close]; self.central.delegate = nil; self.generation++;
        [self.names removeAllObjects]; self.picker = [VWPicker new]; self.picker.names = self.names; self.picker.modalInPresentation = YES;
        __weak typeof(self) weakSelf = self;
        self.picker.selected = ^(CBPeripheral *device) {
            typeof(self) self = weakSelf; if (!self || !self.picker) return;
            [self.central stopScan]; [self.picker dismissViewControllerAnimated:YES completion:nil]; self.picker = nil;
            self.peripheral = device; device.delegate = self;
            [self finish:@"choose" value:device ? @{@"id":device.identifier.UUIDString,@"name":self.names[device.identifier.UUIDString] ?: device.name ?: @"Unbenanntes FTMS-Laufband",@"generation":@(self.generation)} : nil error:device ? nil : @"Geräteauswahl abgebrochen." name:@"NotFoundError"];
        };
        [self store:@"choose" reply:reply seconds:40];
        UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:self.picker]; navigation.modalInPresentation = YES;
        [self.presenter presentViewController:navigation animated:YES completion:nil];
        self.central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()]; return;
    }
    if (!self.peripheral || ![VWString(params[@"deviceId"]) isEqualToString:self.peripheral.identifier.UUIDString] || ![params[@"generation"] isKindOfClass:NSNumber.class] || [params[@"generation"] unsignedIntegerValue] != self.generation) {
        reply(nil,@"Bluetooth-Sitzung ist nicht mehr aktuell.",@"NetworkError"); return;
    }
    if ([method isEqualToString:@"ble.disconnect"]) { [self close]; reply(@{},nil,nil); return; }
    if ([method isEqualToString:@"ble.connect"]) {
        if (self.pending[@"connect"]) { reply(nil,@"Verbindung wird bereits aufgebaut.",@"InvalidStateError"); return; }
        [self store:@"connect" reply:reply seconds:10]; [self.central connectPeripheral:self.peripheral options:nil]; return;
    }
    CBCharacteristic *channel = self.channels[VWString(params[@"uuid"])];
    if (self.peripheral.state != CBPeripheralStateConnected || !channel) { reply(nil,@"FTMS-Kanal nicht verbunden.",@"NetworkError"); return; }
    if ([method isEqualToString:@"ble.notify"]) {
        if (!(channel.properties & (CBCharacteristicPropertyNotify | CBCharacteristicPropertyIndicate))) { reply(nil,@"Dieser FTMS-Kanal bietet keine Meldungen.",@"NotSupportedError"); return; }
        NSString *key = [@"notify:" stringByAppendingString:VWUUID(channel.UUID)];
        if (self.pending[key]) { reply(nil,@"Anmeldung läuft bereits.",@"InvalidStateError"); return; }
        [self store:key reply:reply seconds:10]; [self.peripheral setNotifyValue:YES forCharacteristic:channel]; return;
    }
    if ([method isEqualToString:@"ble.write"]) {
        NSArray *bytes = [params[@"bytes"] isKindOfClass:NSArray.class] ? params[@"bytes"] : @[];
        NSMutableData *data = [NSMutableData new]; BOOL valid = bytes.count > 0 && bytes.count <= 2;
        for (id value in bytes) {
            if (![value isKindOfClass:NSNumber.class] || [value doubleValue] < 0 || [value doubleValue] > 255 || floor([value doubleValue]) != [value doubleValue]) { valid = NO; break; }
            uint8_t byte = [value unsignedCharValue]; [data appendBytes:&byte length:1];
        }
        const uint8_t *b = data.bytes;
        valid = valid && ((data.length == 1 && (b[0] == 0 || b[0] == 7)) || (data.length == 2 && b[0] == 8 && (b[1] == 1 || b[1] == 2)));
        if (!valid || ![channel.UUID isEqual:[CBUUID UUIDWithString:@"2AD9"]]) { reply(nil,@"Nicht erlaubter FTMS-Befehl.",@"SecurityError"); return; }
        if (!(channel.properties & CBCharacteristicPropertyWrite)) { reply(nil,@"Keine bestätigten Schreibzugriffe möglich.",@"NotSupportedError"); return; }
        if (self.pending[@"write"]) { reply(nil,@"Ein Bluetooth-Schreibzugriff wartet noch auf Bestätigung.",@"InvalidStateError"); return; }
        [self store:@"write" reply:reply seconds:10]; [self.peripheral writeValue:data forCharacteristic:channel type:CBCharacteristicWriteWithResponse]; return;
    }
    reply(nil,@"Unbekannter Bluetooth-Aufruf.",@"NotSupportedError");
}
- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    if (central != self.central) return;
    if (central.state == CBManagerStatePoweredOn) [self scan];
    else if (central.state != CBManagerStateUnknown && central.state != CBManagerStateResetting) {
        [self finish:@"choose" value:nil error:@"Bluetooth ist ausgeschaltet oder der Zugriff wurde nicht erlaubt." name:@"NotAllowedError"];
        [self.picker dismissViewControllerAnimated:YES completion:nil]; self.picker = nil; [self close];
    }
}
- (void)centralManager:(CBCentralManager *)central didDiscoverPeripheral:(CBPeripheral *)device advertisementData:(NSDictionary<NSString *,id> *)advertisementData RSSI:(NSNumber *)RSSI {
    if (central != self.central || !self.picker) return;
    NSString *name = VWString(advertisementData[CBAdvertisementDataLocalNameKey]); if (name.length) self.names[device.identifier.UUIDString] = name;
    if (![self.picker.devices containsObject:device]) [self.picker.devices addObject:device]; self.picker.tableView.backgroundView = nil; [self.picker.tableView reloadData];
}
- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)device {
    if (central != self.central || device != self.peripheral) return;
    device.delegate = self; [device discoverServices:@[[CBUUID UUIDWithString:@"1826"]]];
}
- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)device error:(NSError *)error {
    if (central != self.central || device != self.peripheral) return;
    [self finish:@"connect" value:nil error:error.localizedDescription ?: @"Bluetooth-Verbindung nicht hergestellt." name:@"NetworkError"]; [self close];
}
- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)device error:(NSError *)error {
    if (central == self.central && device == self.peripheral) [self close];
}
- (void)peripheral:(CBPeripheral *)device didDiscoverServices:(NSError *)error {
    if (device != self.peripheral || !self.pending[@"connect"]) return;
    for (CBService *service in device.services) if ([service.UUID isEqual:[CBUUID UUIDWithString:@"1826"]]) { self.service = service; break; }
    if (error || !self.service) { [self finish:@"connect" value:nil error:error.localizedDescription ?: @"Kein FTMS-Dienst gefunden." name:@"NotFoundError"]; [self close]; return; }
    [device discoverCharacteristics:@[[CBUUID UUIDWithString:@"2ACD"],[CBUUID UUIDWithString:@"2ADA"],[CBUUID UUIDWithString:@"2AD9"]] forService:self.service];
}
- (void)peripheral:(CBPeripheral *)device didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    if (device != self.peripheral || service != self.service || !self.pending[@"connect"]) return;
    if (error) { [self finish:@"connect" value:nil error:error.localizedDescription name:@"NetworkError"]; [self close]; return; }
    NSMutableArray *descriptions = [NSMutableArray new];
    for (CBCharacteristic *channel in service.characteristics) {
        NSString *uuid = VWUUID(channel.UUID); self.channels[uuid] = channel;
        [descriptions addObject:@{@"uuid":uuid,@"properties":@{@"write":@((channel.properties & CBCharacteristicPropertyWrite) != 0),@"notify":@((channel.properties & CBCharacteristicPropertyNotify) != 0),@"indicate":@((channel.properties & CBCharacteristicPropertyIndicate) != 0)}}];
    }
    [self finish:@"connect" value:@{@"characteristics":descriptions} error:nil name:nil];
}
- (void)peripheral:(CBPeripheral *)device didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)channel error:(NSError *)error {
    if (device != self.peripheral || self.channels[VWUUID(channel.UUID)] != channel) return;
    [self finish:[@"notify:" stringByAppendingString:VWUUID(channel.UUID)] value:@{} error:error.localizedDescription ?: (channel.isNotifying ? nil : @"FTMS-Meldungen konnten nicht abonniert werden.") name:@"NetworkError"];
}
- (void)peripheral:(CBPeripheral *)device didWriteValueForCharacteristic:(CBCharacteristic *)channel error:(NSError *)error {
    if (device != self.peripheral || self.channels[VWUUID(channel.UUID)] != channel || ![channel.UUID isEqual:[CBUUID UUIDWithString:@"2AD9"]]) return;
    [self finish:@"write" value:@{} error:error.localizedDescription name:@"NetworkError"];
}
- (void)peripheral:(CBPeripheral *)device didUpdateValueForCharacteristic:(CBCharacteristic *)channel error:(NSError *)error {
    if (device != self.peripheral || self.channels[VWUUID(channel.UUID)] != channel || error || !channel.value) return;
    NSMutableArray *bytes = [NSMutableArray new]; const uint8_t *data = channel.value.bytes;
    for (NSUInteger i = 0; i < channel.value.length; i++) [bytes addObject:@(data[i])];
    if (self.emit) self.emit(@{@"type":@"ble.value",@"deviceId":device.identifier.UUIDString,@"generation":@(self.generation),@"uuid":VWUUID(channel.UUID),@"bytes":bytes});
}
@end

@interface VWCast : NSObject <GCKSessionManagerListener, GCKRemoteMediaClientListener, GCKRequestDelegate>
@property(nonatomic, copy) VWEvent emit;
@property(nonatomic, strong) GCKRemoteMediaClient *client;
@property(nonatomic, strong) NSMapTable<GCKRequest *, NSDictionary *> *pending;
@property(nonatomic, strong) NSString *sessionToken;
@property(nonatomic, strong) GCKMediaStatus *latestStatus;
@property(nonatomic, assign) NSTimeInterval statusAt;
@property(nonatomic, assign) BOOL connecting;
@property(nonatomic, strong) NSTimer *poll;
- (void)start;
- (void)handle:(NSString *)method params:(NSDictionary *)params reply:(VWReply)reply;
- (void)publish;
@end
@implementation VWCast
- (void)start {
    self.pending = [NSMapTable strongToStrongObjectsMapTable];
    [[GCKCastContext sharedInstance].sessionManager addListener:self];
    [self attach:[GCKCastContext sharedInstance].sessionManager.currentCastSession];
    __weak typeof(self) weakSelf = self;
    self.poll = [NSTimer scheduledTimerWithTimeInterval:2 repeats:YES block:^(NSTimer *timer) {
        typeof(self) self = weakSelf;
        if (UIApplication.sharedApplication.applicationState == UIApplicationStateActive) [self.client requestStatus];
    }];
}
- (void)attach:(GCKCastSession *)session {
    for (GCKRequest *request in self.pending.keyEnumerator.allObjects) {
        VWReply reply = [self.pending objectForKey:request][@"reply"]; reply(nil,@"TV-Sitzung geändert.",@"NetworkError");
    }
    [self.pending removeAllObjects]; [self.client removeListener:self];
    self.client = session.connectionState == GCKConnectionStateConnected ? session.remoteMediaClient : nil;
    [self.client addListener:self]; self.sessionToken = NSUUID.UUID.UUIDString; self.latestStatus = nil; self.statusAt = 0;
    [self publish]; [self.client requestStatus];
}
- (void)publish {
    GCKCastSession *session = [GCKCastContext sharedInstance].sessionManager.currentCastSession;
    BOOL connected = self.client && session.connectionState == GCKConnectionStateConnected;
    GCKMediaStatus *status = self.latestStatus; id media = NSNull.null;
    if (connected && status) {
        NSString *state = @"unknown";
        switch (status.playerState) {
            case GCKMediaPlayerStatePlaying: state = @"playing"; break;
            case GCKMediaPlayerStatePaused: state = @"paused"; break;
            case GCKMediaPlayerStateBuffering: state = @"buffering"; break;
            case GCKMediaPlayerStateIdle: state = @"idle"; break;
            default: break;
        }
        media = @{@"contentID":status.mediaInformation.contentID ?: status.mediaInformation.contentURL.absoluteString ?: @"",@"mediaSessionID":@(status.mediaSessionID),@"playerState":state,@"rate":isfinite(status.playbackRate) ? @(status.playbackRate) : NSNull.null,@"position":isfinite(status.streamPosition) ? @(status.streamPosition) : @0,@"rateSupported":@([status isMediaCommandSupported:kGCKMediaCommandSetPlaybackRate]),@"playingAd":@(status.playingAd)};
    }
    if (self.emit) self.emit(@{@"type":@"cast.status",@"connected":@(connected),@"connecting":@(self.connecting),@"fresh":@(status && NSProcessInfo.processInfo.systemUptime - self.statusAt <= 6),@"session":self.sessionToken ?: @"",@"device":connected ? session.device.friendlyName ?: @"TV" : @"",@"applicationID":session.applicationMetadata.applicationID ?: @"",@"media":media});
}
- (void)handle:(NSString *)method params:(NSDictionary *)params reply:(VWReply)reply {
    if ([method isEqualToString:@"cast.status"]) { [self publish]; [self.client requestStatus]; reply(@{},nil,nil); return; }
    if ([method isEqualToString:@"cast.show"]) {
        GCKDiscoveryManager *discovery = [GCKCastContext sharedInstance].discoveryManager;
        [discovery startDiscovery];
        [[GCKCastContext sharedInstance] presentCastDialog];
        reply(@{@"discoveredDeviceCount":@(discovery.deviceCount),@"receiverApp":VWYouTubeReceiver},nil,nil);
        return;
    }
    GCKCastSession *session = [GCKCastContext sharedInstance].sessionManager.currentCastSession;
    GCKMediaStatus *status = self.latestStatus;
    if (!self.client || session.connectionState != GCKConnectionStateConnected || ![session.applicationMetadata.applicationID isEqualToString:VWYouTubeReceiver] || !status || status.playingAd || NSProcessInfo.processInfo.systemUptime - self.statusAt > 6 || ![VWString(params[@"session"]) isEqualToString:self.sessionToken] || ![params[@"mediaSessionID"] isKindOfClass:NSNumber.class] || [params[@"mediaSessionID"] integerValue] != status.mediaSessionID || ![VWString(params[@"contentID"]) isEqualToString:status.mediaInformation.contentID ?: status.mediaInformation.contentURL.absoluteString ?: @""]) {
        reply(nil,@"Keine aktuelle und eindeutig zugeordnete YouTube-TV-Sitzung.",@"InvalidStateError"); return;
    }
    if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive) { reply(nil,@"App ist im Hintergrund.",@"InvalidStateError"); return; }
    GCKRequest *request;
    if ([method isEqualToString:@"cast.play"]) request = [self.client play];
    else if ([method isEqualToString:@"cast.pause"]) request = [self.client pause];
    else if ([method isEqualToString:@"cast.stop"]) request = [self.client stop];
    else if ([method isEqualToString:@"cast.rate"]) {
        id rate = params[@"rate"];
        if (![rate isKindOfClass:NSNumber.class] || !isfinite([rate doubleValue]) || [rate doubleValue] < .5 || [rate doubleValue] > 2) { reply(nil,@"Ungültiges TV-Tempo.",@"TypeError"); return; }
        request = [self.client setPlaybackRate:[rate floatValue]];
    } else { reply(nil,@"Unbekannter Cast-Aufruf.",@"NotSupportedError"); return; }
    if (!request) { reply(nil,@"TV-Befehl konnte nicht erstellt werden.",@"NetworkError"); return; }
    NSDictionary *operation = @{@"reply":[reply copy]}; [self.pending setObject:operation forKey:request]; request.delegate = self;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        typeof(self) self = weakSelf; if ([self.pending objectForKey:request] != operation) return;
        [self.pending removeObjectForKey:request]; reply(nil,@"TV-Befehl wurde nicht rechtzeitig bestätigt.",@"TimeoutError");
    });
}
- (void)requestDidComplete:(GCKRequest *)request {
    NSDictionary *operation = [self.pending objectForKey:request]; if (!operation) return;
    [self.pending removeObjectForKey:request]; VWReply reply = operation[@"reply"]; reply(@{@"acknowledged":@YES},nil,nil); [self.client requestStatus];
}
- (void)request:(GCKRequest *)request didFailWithError:(GCKError *)error {
    NSDictionary *operation = [self.pending objectForKey:request]; if (!operation) return;
    [self.pending removeObjectForKey:request]; VWReply reply = operation[@"reply"]; reply(nil,error.localizedDescription ?: @"TV hat den Befehl abgelehnt.",@"NotSupportedError");
}
- (void)request:(GCKRequest *)request didAbortWithReason:(GCKRequestAbortReason)reason {
    NSDictionary *operation = [self.pending objectForKey:request]; if (!operation) return;
    [self.pending removeObjectForKey:request]; VWReply reply = operation[@"reply"]; reply(nil,@"TV-Befehl wurde abgebrochen; Ergebnis unbestätigt.",@"AbortError");
}
- (void)remoteMediaClient:(GCKRemoteMediaClient *)client didUpdateMediaStatus:(GCKMediaStatus *)status {
    if (client != self.client) return; self.latestStatus = status; self.statusAt = NSProcessInfo.processInfo.systemUptime; [self publish];
}
- (void)sessionManager:(GCKSessionManager *)manager willStartCastSession:(GCKCastSession *)session { self.connecting = YES; [self attach:nil]; }
- (void)sessionManager:(GCKSessionManager *)manager didStartCastSession:(GCKCastSession *)session { self.connecting = NO; [self attach:session]; }
- (void)sessionManager:(GCKSessionManager *)manager didResumeCastSession:(GCKCastSession *)session { self.connecting = NO; [self attach:session]; }
- (void)sessionManager:(GCKSessionManager *)manager didEndCastSession:(GCKCastSession *)session withError:(NSError *)error { self.connecting = NO; [self attach:nil]; }
- (void)sessionManager:(GCKSessionManager *)manager didFailToStartCastSession:(GCKCastSession *)session withError:(NSError *)error { self.connecting = NO; [self attach:nil]; }
- (void)sessionManager:(GCKSessionManager *)manager didSuspendCastSession:(GCKCastSession *)session withReason:(GCKConnectionSuspendReason)reason { self.connecting = NO; [self attach:nil]; }
- (void)dealloc { [self.poll invalidate]; [[GCKCastContext sharedInstance].sessionManager removeListener:self]; [self.client removeListener:self]; }
@end

@interface VWHost : UIViewController <WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate>
@property(nonatomic, strong) WKWebView *web;
@property(nonatomic, strong) VWBLE *ble;
@property(nonatomic, strong) VWCast *cast;
@property(nonatomic, strong) NSString *token;
@property(nonatomic, assign) BOOL ready;
- (void)suspend;
- (void)resume;
@end
@implementation VWHost
- (void)call:(NSString *)function value:(NSDictionary *)value {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil]; if (!data) return;
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    [self.web evaluateJavaScript:[NSString stringWithFormat:@"window.%@ && window.%@(%@)",function,function,json] completionHandler:nil];
}
- (void)emit:(NSDictionary *)event { if (self.ready) [self call:@"__vwNativeEvent" value:event]; }
- (void)viewDidLoad {
    [super viewDidLoad]; self.title = @"VirtualWalking · 0.4.0"; self.token = NSUUID.UUID.UUIDString;
    NSString *bridgePath = [NSBundle.mainBundle pathForResource:@"native-bridge" ofType:@"js" inDirectory:@"Web"];
    NSString *bridge = [NSString stringWithContentsOfFile:bridgePath encoding:NSUTF8StringEncoding error:nil];
    NSData *tokenData = [NSJSONSerialization dataWithJSONObject:@[self.token] options:0 error:nil];
    NSString *tokenJSON = [[NSString alloc] initWithData:tokenData encoding:NSUTF8StringEncoding]; tokenJSON = [tokenJSON substringWithRange:NSMakeRange(1, tokenJSON.length - 2)];
    bridge = [bridge stringByReplacingOccurrencesOfString:@"\"__VW_TOKEN__\"" withString:tokenJSON];
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new]; configuration.allowsInlineMediaPlayback = YES; configuration.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    [configuration.userContentController addUserScript:[[WKUserScript alloc] initWithSource:bridge injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [configuration.userContentController addScriptMessageHandler:self name:@"virtualwalking"];
    self.web = [[WKWebView alloc] initWithFrame:CGRectZero configuration:configuration]; self.web.navigationDelegate = self; self.web.UIDelegate = self;
    self.web.translatesAutoresizingMaskIntoConstraints = NO; [self.view addSubview:self.web];
    [NSLayoutConstraint activateConstraints:@[[self.web.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor],[self.web.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],[self.web.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],[self.web.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor]]];
    UIBarButtonItem *button = [[UIBarButtonItem alloc] initWithTitle:@"TV verbinden" style:UIBarButtonItemStylePlain target:self action:@selector(connectTV)];
    button.tintColor = UIColor.systemTealColor;
    button.accessibilityHint = @"Öffnet die TV-Verbindung und die AirServer-Prüfung.";
    // Native AirPlay sender route discovery, independent of Google Cast.
    // A route must actually appear and be selected before media routing can be tested.
    AVRoutePickerView *airPlayPicker = [[AVRoutePickerView alloc] initWithFrame:CGRectMake(0, 0, 42, 36)];
    airPlayPicker.activeTintColor = UIColor.systemPurpleColor;
    airPlayPicker.tintColor = UIColor.systemTealColor;
    airPlayPicker.prioritizesVideoDevices = YES;
    airPlayPicker.accessibilityLabel = @"AirPlay-Empfänger suchen";
    UIBarButtonItem *airPlayItem = [[UIBarButtonItem alloc] initWithCustomView:airPlayPicker];
    self.navigationItem.rightBarButtonItems = @[button, airPlayItem];
    self.ble = [VWBLE new]; self.ble.presenter = self; self.cast = [VWCast new];
    __weak typeof(self) weakSelf = self; VWEvent emit = ^(NSDictionary *event) { [weakSelf emit:event]; }; self.ble.emit = emit; self.cast.emit = emit; [self.cast start];
    NSString *html = [NSString stringWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"native" ofType:@"html" inDirectory:@"Web"] encoding:NSUTF8StringEncoding error:nil];
    [self.web loadHTMLString:html baseURL:[NSURL URLWithString:VWOrigin]];
}
- (void)connectTV {
    if (self.presentedViewController) return;
    UIAlertController *choice = [UIAlertController alertControllerWithTitle:@"TV verbinden" message:nil preferredStyle:UIAlertControllerStyleActionSheet];
    __weak typeof(self) weakSelf = self;
    [choice addAction:[UIAlertAction actionWithTitle:@"AirServer prüfen" style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
        VWReceiverProbeController *probe = [VWReceiverProbeController new];
        UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:probe];
        [weakSelf presentViewController:navigation animated:YES completion:nil];
    }]];
    [choice addAction:[UIAlertAction actionWithTitle:@"Cast-Geräteauswahl" style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
        [[GCKCastContext sharedInstance].discoveryManager startDiscovery];
        [[GCKCastContext sharedInstance] presentCastDialog];
    }]];
    [choice addAction:[UIAlertAction actionWithTitle:@"Abbrechen" style:UIAlertActionStyleCancel handler:nil]];
    choice.popoverPresentationController.barButtonItem = self.navigationItem.rightBarButtonItems.firstObject;
    [self presentViewController:choice animated:YES completion:nil];
}
- (void)suspend { [self emit:@{@"type":@"app.suspend"}]; self.cast.latestStatus = nil; self.cast.statusAt = 0; UIApplication.sharedApplication.idleTimerDisabled = NO; }
- (void)resume { [self emit:@{@"type":@"app.resume"}]; [self.cast.client requestStatus]; UIApplication.sharedApplication.idleTimerDisabled = YES; }
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation { self.ready = YES; [self.cast publish]; }
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (!message.frameInfo.isMainFrame || message.webView != self.web || ![message.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *body = message.body; if (![VWString(body[@"token"]) isEqualToString:self.token]) return;
    NSString *requestID = VWString(body[@"id"]), *method = VWString(body[@"method"]); if (!requestID.length || requestID.length > 32) return;
    NSDictionary *params = [body[@"params"] isKindOfClass:NSDictionary.class] ? body[@"params"] : @{};
    __weak typeof(self) weakSelf = self;
    VWReply reply = ^(id value, NSString *error, NSString *name) {
        [weakSelf call:@"__vwNativeReceive" value:error ? @{@"id":requestID,@"ok":@NO,@"error":@{@"message":error,@"name":name ?: @"Error"}} : @{@"id":requestID,@"ok":@YES,@"result":value ?: NSNull.null}];
    };
    if ([method hasPrefix:@"ble."]) [self.ble handle:method params:params reply:reply];
    else if ([method hasPrefix:@"cast."]) [self.cast handle:method params:params reply:reply];
    else if ([method isEqualToString:@"video.last.get"]) {
        NSDictionary *saved = [NSUserDefaults.standardUserDefaults dictionaryForKey:@"VWLastYouTubeVideo"];
        reply(saved ?: @{},nil,nil);
    } else if ([method isEqualToString:@"video.last.set"]) {
        NSString *videoID = VWString(params[@"id"]); NSString *title = VWString(params[@"title"]);
        NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{11}$" options:0 error:nil];
        if (videoID.length != 11 || [pattern numberOfMatchesInString:videoID options:0 range:NSMakeRange(0,videoID.length)] != 1 || title.length > 512) { reply(nil,@"Ungültiges YouTube-Video.",@"TypeError"); return; }
        [NSUserDefaults.standardUserDefaults setObject:@{@"id":videoID,@"title":title} forKey:@"VWLastYouTubeVideo"];
        reply(@{},nil,nil);
    }
    else if ([method isEqualToString:@"clipboard.read"]) reply(UIPasteboard.generalPasteboard.string ?: @"",nil,nil);
    else reply(nil,@"Unbekannter App-Aufruf.",@"NotSupportedError");
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if (action.targetFrame && !action.targetFrame.isMainFrame) { decisionHandler(WKNavigationActionPolicyAllow); return; }
    NSURL *url = action.request.URL;
    BOOL initial = !self.ready && ([url.scheme isEqualToString:@"about"] || [url.absoluteString isEqualToString:VWOrigin]);
    if (initial) { decisionHandler(WKNavigationActionPolicyAllow); return; }
    decisionHandler(WKNavigationActionPolicyCancel);
    if ([url.scheme isEqualToString:@"https"] || [url.scheme isEqualToString:@"http"]) [self presentViewController:[[SFSafariViewController alloc] initWithURL:url] animated:YES completion:nil];
}
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features { return nil; }
- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"VirtualWalking" message:message preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"Abbrechen" style:UIAlertActionStyleCancel handler:^(UIAlertAction *a) { completionHandler(NO); }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Bestätigen" style:UIAlertActionStyleDestructive handler:^(UIAlertAction *a) { completionHandler(YES); }]];
    [self presentViewController:alert animated:YES completion:nil];
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; [self.ble close]; [self.web.configuration.userContentController removeScriptMessageHandlerForName:@"virtualwalking"]; }
@end

@interface VWSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(nonatomic, strong) UIWindow *window;
@property(nonatomic, strong) VWHost *host;
@end
@implementation VWSceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:UIWindowScene.class]) return;
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene]; self.window.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    self.host = [VWHost new]; self.window.rootViewController = [[UINavigationController alloc] initWithRootViewController:self.host]; [self.window makeKeyAndVisible];
}
- (void)sceneWillResignActive:(UIScene *)scene { [self.host suspend]; }
- (void)sceneDidBecomeActive:(UIScene *)scene { [self.host resume]; }
- (void)sceneDidDisconnect:(UIScene *)scene { [self.host.ble close]; [self.host.web.configuration.userContentController removeScriptMessageHandlerForName:@"virtualwalking"]; }
@end
@interface VWAppDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation VWAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    GCKDiscoveryCriteria *criteria = [[GCKDiscoveryCriteria alloc] initWithApplicationID:VWYouTubeReceiver];
    GCKCastOptions *options = [[GCKCastOptions alloc] initWithDiscoveryCriteria:criteria];
    options.launchOptions = [[GCKLaunchOptions alloc] initWithRelaunchIfRunning:NO]; options.stopReceiverApplicationWhenEndingSession = NO; options.disableAnalyticsLogging = YES;
    [GCKCastContext setSharedInstanceWithOptions:options];
    return YES;
}
@end
int main(int argc, char *argv[]) { @autoreleasepool { return UIApplicationMain(argc,argv,nil,NSStringFromClass(VWAppDelegate.class)); } }
