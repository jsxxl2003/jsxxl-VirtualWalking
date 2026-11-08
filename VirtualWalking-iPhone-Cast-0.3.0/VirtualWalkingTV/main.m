#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <SafariServices/SafariServices.h>
#import <GoogleCast/GoogleCast.h>
#import <Network/Network.h>
#import <math.h>
#import <objc/message.h>
#import <sys/socket.h>
#import <arpa/inet.h>
#import <fcntl.h>
#import <errno.h>
#import <sys/select.h>
#import "VWReceiverProbe.h"
#import "VWReceiverAddress.h"
#import "VWFTMSControl.h"

typedef void (^VWReply)(id value, NSString *error, NSString *name);
typedef void (^VWEvent)(NSDictionary *event);
static NSString *const VWOrigin = @"https://virtualwalking-iphone-bluefy.saltychick64.chatgpt.site/";
static NSString *const VWYouTubeReceiver = @"233637DE";
static NSString *VWString(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }
static NSString *VWUUID(CBUUID *uuid) {
    NSString *value = uuid.UUIDString.lowercaseString;
    return value.length == 4 ? [NSString stringWithFormat:@"0000%@-0000-1000-8000-00805f9b34fb", value] : value;
}
static NSURL *VWReceiverBaseURL(NSString *input) {
    VWReceiverAddress address;
    if (!VWParseReceiverAddress(input.UTF8String, &address)) return nil;
    return [NSURL URLWithString:[NSString stringWithFormat:@"http://%s:%u", address.host, address.port]];
}
static NSURL *VWReceiverRequestURL(NSURL *base, NSString *command, NSDictionary<NSString *, NSString *> *parameters) {
    if (!base) return nil;
    NSURLComponents *parts = [NSURLComponents componentsWithURL:base resolvingAgainstBaseURL:NO];
    parts.path = [@"/" stringByAppendingString:command];
    NSMutableArray<NSURLQueryItem *> *items = [NSMutableArray new];
    for (NSString *name in parameters) [items addObject:[NSURLQueryItem queryItemWithName:name value:parameters[name]]];
    parts.queryItems = items;
    return parts.URL;
}


static GCKCastOptions *VWDirectCastOptions;
static BOOL VWPhilipsProviderStarted = NO;
static BOOL VWPhilipsDeviceCreated = NO;
static BOOL VWPhilipsDevicePublished = NO;
@interface VWPhilipsProvider : GCKDeviceProvider
@property(nonatomic, strong) GCKDevice *philips;
@end
@implementation VWPhilipsProvider
- (instancetype)init {
    if ((self = [super initWithDeviceCategory:@"virtualwalking.philips.direct"])) {
        self.philips = [self createDeviceWithID:@"virtualwalking-philips-192-168-0-53" ipAddress:@"192.168.0.53" servicePort:8009];
        VWPhilipsDeviceCreated = self.philips != nil;
        self.philips.friendlyName = @"Philips Ambilight · Direkt-IP";
    }
    return self;
}
- (void)startDiscovery {
    VWPhilipsProviderStarted = YES;
    [self notifyDidStartDiscovery];
    if (self.philips) { [self notifyDidPublishDevice:self.philips]; VWPhilipsDevicePublished = YES; }
}
- (void)stopDiscovery {}
- (GCKSession *)createSessionForDevice:(GCKDevice *)device sessionID:(NSString *)sessionID sessionOptions:(GCKSessionOptions *)sessionOptions {
    return [[GCKCastSession alloc] initWithDevice:device sessionID:sessionID sessionOptions:sessionOptions castOptions:VWDirectCastOptions];
}
@end

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
@property(nonatomic, strong) NSData *queuedWriteData;
@property(nonatomic, strong) CBCharacteristic *queuedWriteChannel;
@property(nonatomic, assign) BOOL writeWithResponsePending;
@property(nonatomic, strong) NSData *speedFeatures;
@property(nonatomic, strong) NSData *speedLimits;
@property(nonatomic, copy) VWEvent emit;
- (void)handle:(NSString *)method params:(NSDictionary *)params reply:(VWReply)reply;
- (void)close;
@end
@implementation VWBLE
- (instancetype)init { if ((self = [super init])) { self.channels = [NSMutableDictionary new]; self.pending = [NSMutableDictionary new]; self.names = [NSMutableDictionary new]; } return self; }
- (void)finish:(NSString *)key value:(id)value error:(NSString *)error name:(NSString *)name {
    NSDictionary *item = self.pending[key]; if (!item) return;
    [self.pending removeObjectForKey:key];
    if ([key isEqualToString:@"write"]) { self.queuedWriteData = nil; self.queuedWriteChannel = nil; self.writeWithResponsePending = NO; }
    VWReply reply = item[@"reply"]; reply(value, error, name);
}
- (void)flushWriteWithoutResponse {
    if (!self.queuedWriteData || !self.queuedWriteChannel || !self.pending[@"write"]) return;
    CBCharacteristic *channel = self.queuedWriteChannel;
    if (self.peripheral.state != CBPeripheralStateConnected || self.channels[VWUUID(channel.UUID)] != channel) {
        [self finish:@"write" value:nil error:@"Bluetooth-Verbindung vor dem Senden getrennt." name:@"NetworkError"]; return;
    }
    if (!self.peripheral.canSendWriteWithoutResponse) return;
    NSData *data = self.queuedWriteData;
    self.queuedWriteData = nil; self.queuedWriteChannel = nil;
    [self.peripheral writeValue:data forCharacteristic:channel type:CBCharacteristicWriteWithoutResponse];
    // Only handed to Core Bluetooth. bluetooth.js still requires the FTMS indication.
    [self finish:@"write" value:@{@"submitted":@YES,@"withResponse":@NO} error:nil name:nil];
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
    self.peripheral = nil; self.service = nil; self.speedFeatures = nil; self.speedLimits = nil; [self.channels removeAllObjects];
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
    if ([method isEqualToString:@"ble.read"]) {
        BOOL allowed = [channel.UUID isEqual:[CBUUID UUIDWithString:@"2ACC"]] || [channel.UUID isEqual:[CBUUID UUIDWithString:@"2AD4"]];
        if (!allowed || !(channel.properties & CBCharacteristicPropertyRead)) { reply(nil,@"Das Laufband bietet keine lesbaren Tempo-Eigenschaften an.",@"NotSupportedError"); return; }
        NSString *key = [@"read:" stringByAppendingString:VWUUID(channel.UUID)];
        if (self.pending[key]) { reply(nil,@"Lesezugriff läuft bereits.",@"InvalidStateError"); return; }
        [self store:key reply:reply seconds:6]; [self.peripheral readValueForCharacteristic:channel]; return;
    }
    if ([method isEqualToString:@"ble.notify"]) {
        if (!(channel.properties & (CBCharacteristicPropertyNotify | CBCharacteristicPropertyIndicate))) { reply(nil,@"Dieser FTMS-Kanal bietet keine Meldungen.",@"NotSupportedError"); return; }
        NSString *key = [@"notify:" stringByAppendingString:VWUUID(channel.UUID)];
        if (self.pending[key]) { reply(nil,@"Anmeldung läuft bereits.",@"InvalidStateError"); return; }
        [self store:key reply:reply seconds:10]; [self.peripheral setNotifyValue:YES forCharacteristic:channel]; return;
    }
    if ([method isEqualToString:@"ble.write"]) {
        NSArray *bytes = [params[@"bytes"] isKindOfClass:NSArray.class] ? params[@"bytes"] : @[];
        NSMutableData *data = [NSMutableData new]; BOOL valid = bytes.count > 0 && bytes.count <= 3;
        for (id value in bytes) {
            if (![value isKindOfClass:NSNumber.class] || [value doubleValue] < 0 || [value doubleValue] > 255 || floor([value doubleValue]) != [value doubleValue]) { valid = NO; break; }
            uint8_t byte = [value unsignedCharValue]; [data appendBytes:&byte length:1];
        }
        const uint8_t *b = data.bytes;
        valid = valid && VWFTMSCommandAllowed(b, data.length, self.speedFeatures.bytes, self.speedFeatures.length, self.speedLimits.bytes, self.speedLimits.length);
        if (!valid || ![channel.UUID isEqual:[CBUUID UUIDWithString:@"2AD9"]]) { reply(nil,@"Nicht erlaubter FTMS-Befehl.",@"SecurityError"); return; }
        id responseOption = params[@"withResponse"];
        if (responseOption && ![responseOption isKindOfClass:NSNumber.class]) { reply(nil,@"Ungültiger Bluetooth-Schreibmodus.",@"TypeError"); return; }
        BOOL withResponse = responseOption ? [responseOption boolValue] : YES;
        CBCharacteristicProperties required = withResponse ? CBCharacteristicPropertyWrite : CBCharacteristicPropertyWriteWithoutResponse;
        if (!(channel.properties & required)) { reply(nil,withResponse ? @"Keine bestätigten Schreibzugriffe möglich." : @"Das Laufband bietet kein Schreiben ohne GATT-Bestätigung an.",@"NotSupportedError"); return; }
        if (self.pending[@"write"]) { reply(nil,@"Ein Bluetooth-Schreibzugriff wartet noch auf Bestätigung.",@"InvalidStateError"); return; }
        if (!withResponse && (b[0] == 7 || b[0] == 2)) {
            // Never defer a start or speed change until after the user cancels it.
            if (!self.peripheral.canSendWriteWithoutResponse) { reply(nil,@"Bluetooth-Schreibpuffer nicht bereit. Der Motorbefehl wurde nicht eingereiht.",@"NetworkError"); return; }
            [self.peripheral writeValue:data forCharacteristic:channel type:CBCharacteristicWriteWithoutResponse];
            reply(@{@"submitted":@YES,@"withResponse":@NO},nil,nil); return;
        }
        [self store:@"write" reply:reply seconds:10];
        self.writeWithResponsePending = withResponse;
        if (withResponse) [self.peripheral writeValue:data forCharacteristic:channel type:CBCharacteristicWriteWithResponse];
        else { self.queuedWriteData = data; self.queuedWriteChannel = channel; [self flushWriteWithoutResponse]; }
        return;
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
    [device discoverCharacteristics:@[[CBUUID UUIDWithString:@"2ACD"],[CBUUID UUIDWithString:@"2ADA"],[CBUUID UUIDWithString:@"2AD9"],[CBUUID UUIDWithString:@"2ACC"],[CBUUID UUIDWithString:@"2AD4"]] forService:self.service];
}
- (void)peripheral:(CBPeripheral *)device didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    if (device != self.peripheral || service != self.service || !self.pending[@"connect"]) return;
    if (error) { [self finish:@"connect" value:nil error:error.localizedDescription name:@"NetworkError"]; [self close]; return; }
    NSMutableArray *descriptions = [NSMutableArray new];
    for (CBCharacteristic *channel in service.characteristics) {
        NSString *uuid = VWUUID(channel.UUID); self.channels[uuid] = channel;
        // Explicit NSNumber booleans: boxing a C comparison produces JSON 0/1.
        [descriptions addObject:@{@"uuid":uuid,@"properties":@{@"read":(channel.properties & CBCharacteristicPropertyRead) ? @YES : @NO,@"write":(channel.properties & CBCharacteristicPropertyWrite) ? @YES : @NO,@"writeWithoutResponse":(channel.properties & CBCharacteristicPropertyWriteWithoutResponse) ? @YES : @NO,@"notify":(channel.properties & CBCharacteristicPropertyNotify) ? @YES : @NO,@"indicate":(channel.properties & CBCharacteristicPropertyIndicate) ? @YES : @NO}}];
    }
    [self finish:@"connect" value:@{@"characteristics":descriptions} error:nil name:nil];
}
- (void)peripheral:(CBPeripheral *)device didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)channel error:(NSError *)error {
    if (device != self.peripheral || self.channels[VWUUID(channel.UUID)] != channel) return;
    [self finish:[@"notify:" stringByAppendingString:VWUUID(channel.UUID)] value:@{} error:error.localizedDescription ?: (channel.isNotifying ? nil : @"FTMS-Meldungen konnten nicht abonniert werden.") name:@"NetworkError"];
}
- (void)peripheral:(CBPeripheral *)device didWriteValueForCharacteristic:(CBCharacteristic *)channel error:(NSError *)error {
    if (device != self.peripheral || !self.writeWithResponsePending || self.channels[VWUUID(channel.UUID)] != channel || ![channel.UUID isEqual:[CBUUID UUIDWithString:@"2AD9"]]) return;
    [self finish:@"write" value:@{} error:error.localizedDescription name:@"NetworkError"];
}
- (void)peripheralIsReadyToSendWriteWithoutResponse:(CBPeripheral *)device {
    if (device == self.peripheral) [self flushWriteWithoutResponse];
}
- (void)peripheral:(CBPeripheral *)device didUpdateValueForCharacteristic:(CBCharacteristic *)channel error:(NSError *)error {
    if (device != self.peripheral || self.channels[VWUUID(channel.UUID)] != channel) return;
    NSString *readKey = [@"read:" stringByAppendingString:VWUUID(channel.UUID)];
    BOOL reading = self.pending[readKey] != nil;
    if (error || !channel.value) { if (reading) [self finish:readKey value:nil error:error.localizedDescription ?: @"Leere Tempo-Eigenschaften empfangen." name:@"NetworkError"]; return; }
    NSMutableArray *bytes = [NSMutableArray new]; const uint8_t *data = channel.value.bytes;
    for (NSUInteger i = 0; i < channel.value.length; i++) [bytes addObject:@(data[i])];
    if (reading) {
        if ([channel.UUID isEqual:[CBUUID UUIDWithString:@"2ACC"]]) self.speedFeatures = [channel.value copy];
        if ([channel.UUID isEqual:[CBUUID UUIDWithString:@"2AD4"]]) self.speedLimits = [channel.value copy];
        [self finish:readKey value:@{@"bytes":bytes} error:nil name:nil]; return;
    }
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
@property(nonatomic, strong) NSURLSession *receiverSession;
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
    [super viewDidLoad]; self.title = @"VirtualWalking · 0.4.15"; self.token = NSUUID.UUID.UUIDString;
    NSURLSessionConfiguration *receiverConfig = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    receiverConfig.HTTPMaximumConnectionsPerHost = 1;
    receiverConfig.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    receiverConfig.timeoutIntervalForRequest = 5;
    receiverConfig.timeoutIntervalForResource = 8;
    self.receiverSession = [NSURLSession sessionWithConfiguration:receiverConfig];
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
    button.accessibilityHint = @"Verwendet die gespeicherte Verbindung zur waipu.tv Box.";
    self.navigationItem.rightBarButtonItem = button;
    self.ble = [VWBLE new]; self.ble.presenter = self; self.cast = [VWCast new];
    __weak typeof(self) weakSelf = self; VWEvent emit = ^(NSDictionary *event) { [weakSelf emit:event]; }; self.ble.emit = emit; self.cast.emit = emit; [self.cast start];
    NSString *html = [NSString stringWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"native" ofType:@"html" inDirectory:@"Web"] encoding:NSUTF8StringEncoding error:nil];
    [self.web loadHTMLString:html baseURL:[NSURL URLWithString:VWOrigin]];
}
- (NSDictionary *)receiverConnection {
    NSDictionary *saved = [NSUserDefaults.standardUserDefaults dictionaryForKey:@"VWTVReceiverConnection"];
    if (saved) return saved;
    // Preserve the previous pairing until the user confirms the box's new address.
    return @{@"address":@"http://192.168.0.32:8765", @"key":[NSUserDefaults.standardUserDefaults stringForKey:@"VWTVReceiverKey"] ?: @""};
}
- (void)receiverCommand:(NSString *)method params:(NSDictionary *)params reply:(VWReply)reply {
    NSDictionary *connection = [self receiverConnection];
    NSString *key = VWString(connection[@"key"]);
    NSURL *base = VWReceiverBaseURL(VWString(connection[@"address"]));
    if ([method isEqualToString:@"tv.receiver.connection"]) { reply(@{@"connected":@(key.length == 24 && base != nil), @"address":base.absoluteString ?: @""}, nil, nil); return; }
    if (key.length != 24 || !base) { reply(nil, @"Zuerst unter „TV verbinden“ die Adresse und den Schlüssel vom Fernseher eingeben.", @"NotConnectedError"); return; }
    NSString *command = [method substringFromIndex:[@"tv.receiver." length]];
    if (![@[@"status",@"play",@"pause",@"resume",@"stop",@"rate"] containsObject:command]) { reply(nil,@"Unbekannter TV-Befehl.",@"NotSupportedError"); return; }
    NSMutableDictionary<NSString *, NSString *> *parts = [NSMutableDictionary dictionaryWithObject:key forKey:@"key"];
    if ([method isEqualToString:@"tv.receiver.play"]) {
        NSString *videoID = VWString(params[@"id"]);
        NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{11}$" options:0 error:nil];
        if ([regex numberOfMatchesInString:videoID options:0 range:NSMakeRange(0, videoID.length)] != 1) { reply(nil, @"Ungültige YouTube-ID.", @"TypeError"); return; }
        parts[@"id"] = videoID;
    }
    if ([method isEqualToString:@"tv.receiver.rate"]) {
        NSNumber *rate = [params[@"value"] isKindOfClass:NSNumber.class] ? params[@"value"] : nil;
        if (!rate || !isfinite(rate.doubleValue) || rate.doubleValue < 0.25 || rate.doubleValue > 2.0) { reply(nil, @"Ungültiges Videotempo.", @"TypeError"); return; }
        parts[@"value"] = rate.stringValue;
    }
    NSURL *url = VWReceiverRequestURL(base, command, parts);
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.timeoutInterval = 5;
    [[self.receiverSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        id json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error) reply(nil, [NSString stringWithFormat:@"TV %@:%@/%@: %@", base.host, base.port, command, error.localizedDescription], @"NetworkError");
            else if (http.statusCode != 200) reply(nil, VWString([json isKindOfClass:NSDictionary.class] ? json[@"error"] : nil).length ? VWString(json[@"error"]) : [NSString stringWithFormat:@"TV antwortet mit HTTP %ld.", (long)http.statusCode], @"NetworkError");
            else reply(json ?: @{}, nil, nil);
        });
    }] resume];
}
- (void)connectWaipuDirect {
    NSDictionary *connection = [self receiverConnection];
    UIAlertController *dialog = [UIAlertController alertControllerWithTitle:@"waipu.tv · Direktverbindung"
        message:@"Adresse und Schlüssel vom Fernseher eingeben. Beides wird nach erfolgreicher Verbindung gespeichert."
        preferredStyle:UIAlertControllerStyleAlert];
    [dialog addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = @"TV-Adresse, z. B. http://192.168.0.119:8765";
        field.keyboardType = UIKeyboardTypeURL;
        field.autocapitalizationType = UITextAutocapitalizationTypeNone;
        field.autocorrectionType = UITextAutocorrectionTypeNo;
        field.text = VWString(connection[@"address"]);
    }];
    [dialog addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = @"Schlüssel vom Fernseher";
        field.autocapitalizationType = UITextAutocapitalizationTypeNone;
        field.autocorrectionType = UITextAutocorrectionTypeNo;
        field.text = VWString(connection[@"key"]);
    }];
    __weak typeof(self) weakSelf = self;
    [dialog addAction:[UIAlertAction actionWithTitle:@"Abbrechen" style:UIAlertActionStyleCancel handler:nil]];
    [dialog addAction:[UIAlertAction actionWithTitle:@"Verbinden" style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
        NSURL *base = VWReceiverBaseURL(dialog.textFields[0].text);
        NSString *key = [dialog.textFields[1].text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (!base || key.length != 24) {
            UIAlertController *alert = [UIAlertController alertControllerWithTitle:!base ? @"TV-Adresse ungültig" : @"Schlüssel ungültig" message:!base ? @"Bitte die IPv4-Adresse vom Fernseher eingeben, z. B. http://192.168.0.119:8765." : @"Bitte den 24-stelligen Schlüssel vom Fernseher eingeben." preferredStyle:UIAlertControllerStyleAlert];
            [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleCancel handler:nil]];
            [weakSelf presentViewController:alert animated:YES completion:nil]; return;
        }
        NSURL *url = VWReceiverRequestURL(base, @"status", @{@"key":key});
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        request.timeoutInterval = 6;
        [[weakSelf.receiverSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            id json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            BOOL connected = !error && http.statusCode == 200 && [json isKindOfClass:NSDictionary.class] && [VWString(json[@"receiver"]) isEqualToString:@"VirtualWalking-TV"];
            dispatch_async(dispatch_get_main_queue(), ^{
                if (!weakSelf) return;
                if (connected) {
                    [NSUserDefaults.standardUserDefaults setObject:@{@"address":base.absoluteString,@"key":key} forKey:@"VWTVReceiverConnection"];
                    [weakSelf emit:@{@"type":@"tv.receiver.connected",@"address":base.absoluteString}];
                }
                NSString *detail = error.localizedDescription ?: (http.statusCode == 403 ? @"Schlüssel ungültig. Den aktuellen Schlüssel vom Fernseher verwenden." : http.statusCode == 200 ? @"An dieser Adresse antwortet kein VirtualWalking-TV-Empfänger." : [NSString stringWithFormat:@"HTTP %ld", (long)http.statusCode]);
                NSString *version = [json isKindOfClass:NSDictionary.class] ? VWString(json[@"version"]) : @"";
                NSString *message = connected ? [NSString stringWithFormat:@"Mit %@ verbunden. TV-Empfänger %@. Adresse und Schlüssel sind gespeichert.", base.absoluteString, version.length ? version : @"Version unbekannt"] : [NSString stringWithFormat:@"Keine Verbindung zu %@: %@", base.absoluteString, detail];
                UIAlertController *result = [UIAlertController alertControllerWithTitle:connected ? @"waipu.tv verbunden" : @"Verbindung fehlgeschlagen" message:message preferredStyle:UIAlertControllerStyleAlert];
                [result addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
                [weakSelf presentViewController:result animated:YES completion:nil];
            });
        }] resume];
    }]];
    [self presentViewController:dialog animated:YES completion:nil];
}
- (void)connectTV {
    if (self.presentedViewController || !self.navigationItem.rightBarButtonItem.enabled) return;
    NSDictionary *connection = [self receiverConnection];
    NSString *address = VWString(connection[@"address"]);
    if (VWString(connection[@"key"]).length != 24 || !VWReceiverBaseURL(address)) {
        [self connectWaipuDirect]; return;
    }
    UIBarButtonItem *button = self.navigationItem.rightBarButtonItem;
    button.enabled = NO; button.title = @"Verbinde …";
    __weak typeof(self) weakSelf = self;
    [self receiverCommand:@"tv.receiver.status" params:@{} reply:^(id value, NSString *error, NSString *name) {
        button.enabled = YES; button.title = @"TV verbinden";
        if (!weakSelf) return;
        if (!error && [value isKindOfClass:NSDictionary.class] && [VWString(value[@"receiver"]) isEqualToString:@"VirtualWalking-TV"]) {
            [weakSelf emit:@{@"type":@"tv.receiver.connected",@"address":address,@"reuse":@YES}];
            return;
        }
        UIAlertController *result = [UIAlertController alertControllerWithTitle:@"TV-Verbindung fehlgeschlagen"
            message:error ?: @"An der gespeicherten Adresse antwortet kein VirtualWalking-TV-Empfänger."
            preferredStyle:UIAlertControllerStyleAlert];
        [result addAction:[UIAlertAction actionWithTitle:@"Verbindung bearbeiten" style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
            [weakSelf dismissViewControllerAnimated:YES completion:^{ [weakSelf connectWaipuDirect]; }];
        }]];
        [result addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleCancel handler:nil]];
        [weakSelf presentViewController:result animated:YES completion:nil];
    }];
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
    else if ([method hasPrefix:@"tv.receiver."]) [self receiverCommand:method params:params reply:reply];
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
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; [self.ble close]; [self.receiverSession invalidateAndCancel]; [self.web.configuration.userContentController removeScriptMessageHandlerForName:@"virtualwalking"]; }
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
    // Discover standard Cast receivers first; YouTube app support is checked after connecting.
    GCKDiscoveryCriteria *criteria = [[GCKDiscoveryCriteria alloc] initWithApplicationID:kGCKDefaultMediaReceiverApplicationID];
    GCKCastOptions *options = [[GCKCastOptions alloc] initWithDiscoveryCriteria:criteria];
    options.launchOptions = [[GCKLaunchOptions alloc] initWithRelaunchIfRunning:NO]; options.stopReceiverApplicationWhenEndingSession = NO; options.disableAnalyticsLogging = YES;
    VWDirectCastOptions = options;
    [GCKCastContext setSharedInstanceWithOptions:options];
    [[GCKCastContext sharedInstance] registerDeviceProvider:[VWPhilipsProvider new]];
    return YES;
}
@end
int main(int argc, char *argv[]) { @autoreleasepool { return UIApplicationMain(argc,argv,nil,NSStringFromClass(VWAppDelegate.class)); } }
