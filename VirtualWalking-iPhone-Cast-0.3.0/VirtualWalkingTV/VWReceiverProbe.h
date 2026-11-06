#import <Foundation/Foundation.h>
#import <Network/Network.h>
#import <Security/Security.h>
#import <UIKit/UIKit.h>
#include <arpa/inet.h>
#include <netdb.h>
#import "VWProbeWire.h"

static NSString *VWProbeText(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }
static BOOL VWProbePrivateAddress(NSString *host) {
    struct in_addr ip;
    if (inet_pton(AF_INET, host.UTF8String, &ip) != 1) return NO;
    uint32_t n = ntohl(ip.s_addr);
    return (n >> 24) == 10 || (n >> 20) == 0xac1 || (n >> 16) == 0xc0a8 || (n >> 16) == 0xa9fe;
}
static NSString *VWProbeSliceText(VWProbeSlice slice) {
    return slice.bytes ? [[NSString alloc] initWithBytes:slice.bytes length:slice.length encoding:NSUTF8StringEncoding] ?: @"" : @"";
}

// This separate connection never joins an SDK session or launches a receiver.
@interface VWReadOnlyCastProbe : NSObject
@property(nonatomic, strong) nw_connection_t connection;
@property(nonatomic, strong) NSMutableData *buffer;
@property(nonatomic, strong) NSMutableDictionary *result;
@property(nonatomic, copy) void (^completion)(NSDictionary *);
@property(nonatomic, copy) NSString *transport;
@property(nonatomic, assign) BOOL finished;
@property(nonatomic, assign) BOOL mediaRequested;
@property(nonatomic, assign) BOOL launchRequested;
@property(nonatomic, assign) BOOL launchSent;
@property(nonatomic, copy) NSString *videoID;
@property(nonatomic, copy) NSString *sessionID;
@property(nonatomic, assign) BOOL loadSent;
@property(nonatomic, assign) BOOL mdxAdvertised;
@property(nonatomic, strong) NSMutableArray *mediaEvents;
- (void)startHost:(NSString *)host port:(NSInteger)port completion:(void (^)(NSDictionary *))completion;
- (void)startHost:(NSString *)host port:(NSInteger)port launch:(BOOL)launch completion:(void (^)(NSDictionary *))completion;
- (void)startHost:(NSString *)host videoID:(NSString *)videoID completion:(void (^)(NSDictionary *))completion;
- (void)cancel;
@end
@implementation VWReadOnlyCastProbe
- (void)finish {
    if (self.finished) return; self.finished = YES;
    nw_connection_cancel(self.connection); self.connection = nil;
    void (^completion)(NSDictionary *) = self.completion; self.completion = nil;
    if (completion) completion(self.result);
}
- (void)cancel { self.completion = nil; [self finish]; }
- (void)send:(NSString *)type destination:(NSString *)destination nameSpace:(NSString *)nameSpace {
    BOOL allowed = ([type isEqualToString:@"CONNECT"] && [nameSpace isEqualToString:@"urn:x-cast:com.google.cast.tp.connection"]) ||
        ([type isEqualToString:@"GET_STATUS"] && ([nameSpace isEqualToString:@"urn:x-cast:com.google.cast.receiver"] || [nameSpace isEqualToString:@"urn:x-cast:com.google.cast.media"])) ||
        ([type isEqualToString:@"PONG"] && [nameSpace isEqualToString:@"urn:x-cast:com.google.cast.tp.heartbeat"]) ||
        ([type isEqualToString:@"LAUNCH"] && [nameSpace isEqualToString:@"urn:x-cast:com.google.cast.receiver"] && [destination isEqualToString:@"receiver-0"]) ||
        ([type isEqualToString:@"LOAD"] && [nameSpace isEqualToString:@"urn:x-cast:com.google.cast.media"] && self.videoID.length == 11);
    if (!allowed || self.finished) return;
    NSDictionary *command = [type isEqualToString:@"LAUNCH"] ? @{@"type":@"LAUNCH",@"appId":@"233637DE",@"requestId":@2} : [type isEqualToString:@"LOAD"] ? @{@"type":@"LOAD",@"requestId":@3,@"autoplay":@YES,@"media":@{@"contentId":[@"https://www.youtube.com/watch?v=" stringByAppendingString:self.videoID],@"contentType":@"video/mp4",@"streamType":@"BUFFERED"}} : @{@"type":type,@"requestId":@1};
    NSData *json = [NSJSONSerialization dataWithJSONObject:command options:0 error:nil];
    NSString *payload = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    uint8_t bytes[4096]; size_t length = VWProbeEncode(bytes, sizeof(bytes), destination.UTF8String, nameSpace.UTF8String, payload.UTF8String);
    if (!length) { self.result[@"error"] = @"Cast-Nachricht zu groß"; [self finish]; return; }
    dispatch_data_t data = dispatch_data_create(bytes, length, NULL, DISPATCH_DATA_DESTRUCTOR_DEFAULT);
    __weak typeof(self) weakSelf = self;
    nw_connection_send(self.connection, data, NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, false, ^(nw_error_t error) {
        typeof(self) self = weakSelf;
        if (error && !self.finished) { self.result[@"error"] = @"Cast-Schreibzugriff fehlgeschlagen"; [self finish]; }
    });
}
- (void)message:(VWProbeEnvelope)envelope {
    NSString *nameSpace = VWProbeSliceText(envelope.nameSpace);
    NSData *json = [NSData dataWithBytes:envelope.payload.bytes length:envelope.payload.length];
    id object = [NSJSONSerialization JSONObjectWithData:json options:0 error:nil];
    if (![object isKindOfClass:NSDictionary.class]) return;
    NSDictionary *body = object; NSString *type = VWProbeText(body[@"type"]);
    if (self.videoID.length && ([nameSpace isEqualToString:@"urn:x-cast:com.google.youtube.mdx"] || [nameSpace isEqualToString:@"urn:x-cast:com.google.cast.media"])) {
        if (!self.mediaEvents) self.mediaEvents = [NSMutableArray new];
        if (self.mediaEvents.count < 24) {
            NSMutableDictionary *event = [@{@"namespace":nameSpace,@"type":type.length ? type : @"(ohne type)"} mutableCopy];
            for (NSString *key in @[@"requestId",@"reason",@"detailedErrorCode",@"errorCode",@"playerState"]) {
                id value = body[key]; if ([value isKindOfClass:NSString.class] || [value isKindOfClass:NSNumber.class]) event[key] = value;
            }
            [self.mediaEvents addObject:event]; self.result[@"mediaEvents"] = [self.mediaEvents copy];
        }
    }
    if ([nameSpace isEqualToString:@"urn:x-cast:com.google.cast.tp.heartbeat"] && [type isEqualToString:@"PING"]) {
        [self send:@"PONG" destination:VWProbeSliceText(envelope.source) nameSpace:nameSpace]; return;
    }
    if ([nameSpace isEqualToString:@"urn:x-cast:com.google.cast.receiver"] && [type isEqualToString:@"RECEIVER_STATUS"]) {
        self.result[@"protocolConfirmed"] = @YES;
        NSDictionary *status = [body[@"status"] isKindOfClass:NSDictionary.class] ? body[@"status"] : @{};
        NSArray *apps = [status[@"applications"] isKindOfClass:NSArray.class] ? status[@"applications"] : @[];
        NSMutableArray *descriptions = [NSMutableArray new];
        for (id entry in apps) {
            if (![entry isKindOfClass:NSDictionary.class]) continue;
            NSMutableArray *namespaces = [NSMutableArray new];
            NSArray *items = [entry[@"namespaces"] isKindOfClass:NSArray.class] ? entry[@"namespaces"] : @[];
            for (id item in items) if ([item isKindOfClass:NSDictionary.class] && VWProbeText(item[@"name"]).length) [namespaces addObject:VWProbeText(item[@"name"])];
            [descriptions addObject:@{@"appId":VWProbeText(entry[@"appId"]),@"name":VWProbeText(entry[@"displayName"]),@"namespaces":namespaces}];
            if (!self.transport && [namespaces containsObject:@"urn:x-cast:com.google.cast.media"] && VWProbeText(entry[@"transportId"]).length) self.transport = VWProbeText(entry[@"transportId"]);
        }
        self.result[@"applications"] = descriptions;
        if (self.launchRequested) {
            BOOL running = NO;
            for (NSDictionary *app in descriptions) if ([app[@"appId"] isEqualToString:@"233637DE"]) running = YES;
            if (running) {
                self.result[@"youtubeRunning"] = @YES;
                if (!self.videoID.length) { [self finish]; return; }
                NSDictionary *app = nil;
                for (NSDictionary *item in apps) if ([item[@"appId"] isEqualToString:@"233637DE"]) { app = item; break; }
                NSArray *appNamespaces = [app[@"namespaces"] isKindOfClass:NSArray.class] ? app[@"namespaces"] : @[];
                for (NSDictionary *item in appNamespaces) if ([item[@"name"] isEqualToString:@"urn:x-cast:com.google.youtube.mdx"]) self.mdxAdvertised = YES;
                self.result[@"youtubeMdxAdvertised"] = @(self.mdxAdvertised);
                NSString *transport = VWProbeText(app[@"transportId"]);
                if (transport.length && !self.loadSent) {
                    self.loadSent = YES;
                    [self send:@"CONNECT" destination:transport nameSpace:@"urn:x-cast:com.google.cast.tp.connection"];
                    // Query the existing media session before testing playback. Do not guess MDX commands.
                    [self send:@"GET_STATUS" destination:transport nameSpace:@"urn:x-cast:com.google.cast.media"];
                    [self send:@"LOAD" destination:transport nameSpace:@"urn:x-cast:com.google.cast.media"];
                    self.result[@"videoLoadSent"] = @YES;
                }
                return;
            }
            if (!self.launchSent) {
                self.launchSent = YES;
                [self send:@"LAUNCH" destination:@"receiver-0" nameSpace:@"urn:x-cast:com.google.cast.receiver"];
                self.result[@"launchCommandSent"] = @YES;
                return;
            }
            return;
        }
        if (self.transport && !self.mediaRequested) {
            self.mediaRequested = YES;
            [self send:@"CONNECT" destination:self.transport nameSpace:@"urn:x-cast:com.google.cast.tp.connection"];
            [self send:@"GET_STATUS" destination:self.transport nameSpace:@"urn:x-cast:com.google.cast.media"];
        } else if (!self.mediaRequested) [self finish];
    } else if ([nameSpace isEqualToString:@"urn:x-cast:com.google.cast.media"] && [type isEqualToString:@"MEDIA_STATUS"]) {
        NSMutableArray *media = [NSMutableArray new];
        NSArray *statuses = [body[@"status"] isKindOfClass:NSArray.class] ? body[@"status"] : @[];
        for (id item in statuses) {
            if (![item isKindOfClass:NSDictionary.class]) continue;
            NSDictionary *info = [item[@"media"] isKindOfClass:NSDictionary.class] ? item[@"media"] : @{};
            NSMutableDictionary *safe = [NSMutableDictionary new];
            for (NSString *key in @[@"playerState",@"playbackRate",@"supportedMediaCommands"]) if ([item[key] isKindOfClass:NSString.class] || [item[key] isKindOfClass:NSNumber.class]) safe[key] = item[key];
            for (NSString *key in @[@"contentType",@"streamType",@"duration"]) if ([info[key] isKindOfClass:NSString.class] || [info[key] isKindOfClass:NSNumber.class]) safe[key] = info[key];
            // Deliberately omit contentId, contentURL, metadata and private filenames.
            [media addObject:safe];
        }
        self.result[@"media"] = media;
        if (self.videoID.length) {
            BOOL playing = NO;
            for (NSDictionary *item in media) if ([item[@"playerState"] isEqualToString:@"PLAYING"] || [item[@"playerState"] isEqualToString:@"BUFFERING"]) playing = YES;
            self.result[@"playbackObserved"] = @(playing);
            if (playing) [self finish];
        } else [self finish];
    } else if ([nameSpace isEqualToString:@"urn:x-cast:com.google.cast.media"] && [type isEqualToString:@"LOAD_FAILED"]) {
        self.result[@"videoLoadFailed"] = @YES; self.result[@"loadFailureReason"] = VWProbeText(body[@"reason"]); [self finish];
    } else if ([nameSpace isEqualToString:@"urn:x-cast:com.google.cast.receiver"] && [type isEqualToString:@"LAUNCH_ERROR"]) {
        self.result[@"launchError"] = VWProbeText(body[@"reason"]); [self finish];
    }
}
- (void)receive {
    if (self.finished) return;
    __weak typeof(self) weakSelf = self;
    nw_connection_receive(self.connection, 1, 16384, ^(dispatch_data_t content, nw_content_context_t context, bool complete, nw_error_t error) {
        typeof(self) self = weakSelf; if (!self || self.finished) return;
        if (content) dispatch_data_apply(content, ^bool(dispatch_data_t region, size_t offset, const void *bytes, size_t size) { [self.buffer appendBytes:bytes length:size]; return true; });
        while (self.buffer.length >= 4 && !self.finished) {
            const uint8_t *b = self.buffer.bytes; uint32_t count = ((uint32_t)b[0] << 24) | ((uint32_t)b[1] << 16) | ((uint32_t)b[2] << 8) | b[3];
            if (!count || count > 262144) { self.result[@"error"] = @"Ungültige Cast-Antwort"; [self finish]; return; }
            if (self.buffer.length < count + 4) break;
            NSData *frame = [self.buffer subdataWithRange:NSMakeRange(4, count)];
            [self.buffer replaceBytesInRange:NSMakeRange(0, count + 4) withBytes:NULL length:0];
            VWProbeEnvelope envelope;
            if (!VWProbeDecode(frame.bytes, frame.length, &envelope)) { self.result[@"error"] = @"Cast-Antwort nicht lesbar"; [self finish]; return; }
            [self message:envelope];
        }
        if (self.finished) return;
        if (error || complete) { self.result[@"error"] = @"Cast-Verbindung beendet"; [self finish]; } else [self receive];
    });
}
- (void)startHost:(NSString *)host port:(NSInteger)port completion:(void (^)(NSDictionary *))completion {
    [self startHost:host port:port launch:NO completion:completion];
}
- (void)startHost:(NSString *)host videoID:(NSString *)videoID completion:(void (^)(NSDictionary *))completion {
    self.videoID = videoID;
    [self startHost:host port:8009 launch:YES completion:completion];
}
- (void)startHost:(NSString *)host port:(NSInteger)port launch:(BOOL)launch completion:(void (^)(NSDictionary *))completion {
    self.launchRequested = launch;
    self.completion = completion; self.buffer = [NSMutableData new];
    self.result = [@{@"protocol":@"Google Cast",@"host":host,@"port":@(port),@"protocolConfirmed":@NO,@"launchTest":@(launch),@"videoPlaybackConfirmed":@NO} mutableCopy];
    nw_parameters_t parameters = nw_parameters_create_secure_tcp(^(nw_protocol_options_t options) {
        sec_protocol_options_t tls = nw_tls_copy_sec_protocol_options(options);
        // Only this local, read-only Cast connection accepts the receiver's self-signed certificate.
        sec_protocol_options_set_verify_block(tls, ^(sec_protocol_metadata_t metadata, sec_trust_t trust, sec_protocol_verify_complete_t done) { done(true); }, dispatch_get_main_queue());
    }, NW_PARAMETERS_DEFAULT_CONFIGURATION);
    self.connection = nw_connection_create(nw_endpoint_create_host(host.UTF8String, [@(port).stringValue UTF8String]), parameters);
    nw_connection_set_queue(self.connection, dispatch_get_main_queue());
    __weak typeof(self) weakSelf = self;
    nw_connection_set_state_changed_handler(self.connection, ^(nw_connection_state_t state, nw_error_t error) {
        typeof(self) self = weakSelf; if (!self || self.finished) return;
        if (state == nw_connection_state_ready) {
            self.result[@"tlsConnected"] = @YES;
            [self send:@"CONNECT" destination:@"receiver-0" nameSpace:@"urn:x-cast:com.google.cast.tp.connection"];
            [self send:@"GET_STATUS" destination:@"receiver-0" nameSpace:@"urn:x-cast:com.google.cast.receiver"]; [self receive];
        } else if (state == nw_connection_state_failed) { self.result[@"error"] = @"Cast-Dienst nicht erreichbar"; [self finish]; }
    });
    nw_connection_start(self.connection);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (launch ? 8 : 5) * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        typeof(self) self = weakSelf; if (!self || self.finished) return;
        if (self.videoID.length) self.result[@"note"] = @"MDX ist angekündigt, aber nicht automatisch steuerbar. Ein LOAD-Befehl ohne PLAYING bestätigt keinen Videostart.";
        else self.result[@"note"] = @"Zeitlimit: Eine ausbleibende Antwort beweist keine fehlende Unterstützung.";
        [self finish];
    });
}
@end

@interface VWProbeXML : NSObject <NSXMLParserDelegate>
@property(nonatomic, strong) NSMutableDictionary *values;
@property(nonatomic, strong) NSMutableArray *services;
@property(nonatomic, strong) NSMutableString *text;
@end
@implementation VWProbeXML
- (void)parser:(NSXMLParser *)parser didStartElement:(NSString *)name namespaceURI:(NSString *)uri qualifiedName:(NSString *)qualified attributes:(NSDictionary *)attributes { self.text = [NSMutableString new]; }
- (void)parser:(NSXMLParser *)parser foundCharacters:(NSString *)text { [self.text appendString:text]; }
- (void)parser:(NSXMLParser *)parser didEndElement:(NSString *)name namespaceURI:(NSString *)uri qualifiedName:(NSString *)qualified {
    NSString *value = [self.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if ([@[@"friendlyName",@"manufacturer",@"modelName",@"deviceType"] containsObject:name] && !self.values[name]) self.values[name] = value;
    if ([name isEqualToString:@"serviceType"] && value.length) [self.services addObject:value];
}
@end

@interface VWReceiverProbe : NSObject <NSNetServiceBrowserDelegate, NSNetServiceDelegate, NSURLSessionDataDelegate>
@property(nonatomic, strong) NSMutableArray<NSNetServiceBrowser *> *browsers;
@property(nonatomic, strong) NSMutableArray<NSNetService *> *services;
@property(nonatomic, strong) NSMutableArray *casts;
@property(nonatomic, strong) NSMutableArray *udp;
@property(nonatomic, strong) NSMutableArray<NSDictionary *> *records;
@property(nonatomic, strong) NSMutableSet *queried;
@property(nonatomic, strong) NSURLSession *http;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSMutableData *> *bodies;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSDictionary *> *requests;
@property(nonatomic, copy) void (^update)(NSArray *);
@property(nonatomic, copy) NSString *target;
@property(nonatomic, assign) BOOL stopped;
- (void)start:(NSString *)target update:(void (^)(NSArray *))update;
- (void)stop;
@end
@implementation VWReceiverProbe
- (void)add:(NSDictionary *)record { if (!self.stopped) { [self.records addObject:record]; if (self.update) self.update([self.records copy]); } }
- (void)castHost:(NSString *)host port:(NSInteger)port {
    NSString *key = [NSString stringWithFormat:@"cast:%@:%ld",host,(long)port]; if ([self.queried containsObject:key]) return; [self.queried addObject:key];
    VWReadOnlyCastProbe *probe = [VWReadOnlyCastProbe new]; [self.casts addObject:probe];
    __weak typeof(self) weakSelf = self; [probe startHost:host port:port completion:^(NSDictionary *result) { [weakSelf add:result]; }];
}
- (void)get:(NSURL *)url kind:(NSString *)kind {
    if (self.stopped || !url || ![url.scheme isEqualToString:@"http"] || !VWProbePrivateAddress(url.host) || url.user || url.password) return;
    NSString *key = [kind stringByAppendingString:url.absoluteString]; if ([self.queried containsObject:key]) return; [self.queried addObject:key];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:3]; request.HTTPMethod = @"GET";
    NSURLSessionDataTask *task = [self.http dataTaskWithRequest:request];
    self.requests[@(task.taskIdentifier)] = @{@"kind":kind,@"host":url.host,@"port":url.port ?: @80}; self.bodies[@(task.taskIdentifier)] = [NSMutableData new]; [task resume];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler { completionHandler(nil); }
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler { completionHandler(response.expectedContentLength > 262144 ? NSURLSessionResponseCancel : NSURLSessionResponseAllow); }
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    NSMutableData *body = self.bodies[@(task.taskIdentifier)]; if (body.length + data.length > 262144) { [task cancel]; return; } [body appendData:data];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    NSNumber *key = @(task.taskIdentifier); NSDictionary *request = self.requests[key]; NSData *body = self.bodies[key]; [self.requests removeObjectForKey:key]; [self.bodies removeObjectForKey:key];
    if (self.stopped || !request) return;
    NSMutableDictionary *result = [request mutableCopy]; NSHTTPURLResponse *response = (NSHTTPURLResponse *)task.response;
    result[@"httpStatus"] = @(response.statusCode); result[@"protocolConfirmed"] = @NO;
    if (error) { result[@"error"] = [NSString stringWithFormat:@"%@ (%ld)",error.domain,(long)error.code]; [self add:result]; return; }
    if ([request[@"kind"] isEqualToString:@"AirPlay /info"]) {
        id plist = [NSPropertyListSerialization propertyListWithData:body options:0 format:NULL error:nil];
        if ([plist isKindOfClass:NSDictionary.class]) {
            NSMutableDictionary *info = [NSMutableDictionary new];
            for (NSString *field in @[@"model",@"name",@"features",@"sourceVersion",@"protocolVersion",@"statusFlags"]) if ([plist[field] isKindOfClass:NSString.class] || [plist[field] isKindOfClass:NSNumber.class]) info[field] = plist[field];
            result[@"info"] = info; result[@"protocol"] = @"AirPlay"; result[@"protocolConfirmed"] = @((response.statusCode == 200) && (info[@"features"] || info[@"model"]));
        }
    } else {
        VWProbeXML *reader = [VWProbeXML new]; reader.values = [NSMutableDictionary new]; reader.services = [NSMutableArray new];
        NSXMLParser *parser = [[NSXMLParser alloc] initWithData:body]; parser.shouldProcessNamespaces = YES; parser.shouldResolveExternalEntities = NO; parser.delegate = reader;
        if ([parser parse]) { result[@"device"] = reader.values; result[@"services"] = reader.services;
            BOOL transport = NO; for (NSString *service in reader.services) if ([service containsString:@":AVTransport:"]) transport = YES;
            if (transport && response.statusCode == 200) { result[@"protocol"] = @"UPnP AVTransport (DLNA)"; result[@"protocolConfirmed"] = @YES; }
        }
        for (id header in response.allHeaderFields) if ([[header description].lowercaseString isEqualToString:@"application-url"]) { result[@"dialAdvertised"] = @YES; if (!result[@"protocol"]) { result[@"protocol"] = @"DIAL"; result[@"protocolConfirmed"] = @(response.statusCode == 200); result[@"videoReceptionConfirmed"] = @NO; } }
    }
    [self add:result];
}
- (void)receiveSSDP:(nw_connection_t)connection host:(NSString *)host remaining:(NSUInteger)remaining {
    if (self.stopped || !remaining) return;
    __weak typeof(self) weakSelf = self;
    nw_connection_receive_message(connection, ^(dispatch_data_t data, nw_content_context_t context, bool complete, nw_error_t error) {
        typeof(self) self = weakSelf; if (!self || self.stopped || error) return;
        if (data && dispatch_data_get_size(data) <= 65536) {
            NSMutableData *bytes = [NSMutableData new]; dispatch_data_apply(data, ^bool(dispatch_data_t region, size_t offset, const void *buffer, size_t size) { [bytes appendBytes:buffer length:size]; return true; });
            NSString *text = [[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding];
            for (NSString *line in [text componentsSeparatedByString:@"\n"]) {
                if ([line.lowercaseString hasPrefix:@"location:"]) {
                    NSString *value = [[line substringFromIndex:9] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]; NSURL *url = [NSURL URLWithString:value];
                    if ([url.host isEqualToString:host]) [self get:url kind:@"UPnP device description"];
                }
            }
        }
        [self receiveSSDP:connection host:host remaining:remaining - 1];
    });
}
- (void)ssdpHost:(NSString *)host {
    NSString *key = [@"ssdp:" stringByAppendingString:host]; if ([self.queried containsObject:key]) return; [self.queried addObject:key];
    // Unicast only: no restricted multicast entitlement is required for sideloading.
    nw_connection_t connection = nw_connection_create(nw_endpoint_create_host(host.UTF8String, "1900"), nw_parameters_create_secure_udp(NW_PARAMETERS_DISABLE_PROTOCOL, NW_PARAMETERS_DEFAULT_CONFIGURATION)); [self.udp addObject:connection];
    nw_connection_set_queue(connection, dispatch_get_main_queue()); __weak typeof(self) weakSelf = self;
    nw_connection_set_state_changed_handler(connection, ^(nw_connection_state_t state, nw_error_t error) {
        typeof(self) self = weakSelf; if (!self || self.stopped) return;
        if (state == nw_connection_state_ready) {
            NSString *request = [NSString stringWithFormat:@"M-SEARCH * HTTP/1.1\r\nHOST: %@:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n",host]; NSData *bytes = [request dataUsingEncoding:NSUTF8StringEncoding];
            dispatch_data_t data = dispatch_data_create(bytes.bytes, bytes.length, NULL, DISPATCH_DATA_DESTRUCTOR_DEFAULT);
            nw_connection_send(connection, data, NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, true, ^(nw_error_t sendError) {}); [self receiveSSDP:connection host:host remaining:12];
        }
    });
    nw_connection_start(connection);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ nw_connection_cancel(connection); });
}
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didNotSearch:(NSDictionary *)error { [self add:@{@"kind":@"Bonjour",@"serviceType":browser.description,@"error":error,@"note":@"Suche blockiert oder fehlgeschlagen; kein Nachweis fehlender Unterstützung."}]; }
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didFindService:(NSNetService *)service moreComing:(BOOL)more {
    if (self.stopped || self.services.count >= 24) return;
    for (NSNetService *known in self.services) if ([known.type isEqualToString:service.type] && [known.name isEqualToString:service.name] && [known.domain isEqualToString:service.domain]) return;
    [self.services addObject:service]; service.delegate = self; [service resolveWithTimeout:4];
}
- (void)netService:(NSNetService *)service didNotResolve:(NSDictionary *)error { [self add:@{@"kind":@"Bonjour",@"name":service.name,@"serviceType":service.type,@"error":error}]; }
- (void)netServiceDidResolveAddress:(NSNetService *)service {
    if (self.stopped) return;
    NSString *protocol = [service.type hasPrefix:@"_airplay."] ? @"AirPlay" : [service.type hasPrefix:@"_raop."] ? @"RAOP (Audio)" : [service.type hasPrefix:@"_googlecast."] ? @"Google Cast" : @"DIAL";
    NSMutableArray *addresses = [NSMutableArray new]; NSString *host = nil;
    for (NSData *address in service.addresses) {
        char buffer[NI_MAXHOST]; const struct sockaddr *sa = address.bytes;
        if (address.length < sizeof(struct sockaddr) || getnameinfo(sa, (socklen_t)address.length, buffer, sizeof(buffer), NULL, 0, NI_NUMERICHOST) != 0) continue;
        NSString *value = [NSString stringWithUTF8String:buffer]; [addresses addObject:value]; if (VWProbePrivateAddress(value)) host = value;
    }
    NSMutableDictionary *txt = [NSMutableDictionary new]; NSDictionary *all = service.TXTRecordData ? [NSNetService dictionaryFromTXTRecordData:service.TXTRecordData] : @{};
    for (NSString *key in @[@"fn",@"md",@"model",@"features",@"srcvers",@"protovers",@"flags",@"st"]) { NSData *value = all[key]; if (value && value.length <= 256) txt[key] = [[NSString alloc] initWithData:value encoding:NSUTF8StringEncoding] ?: @"(binär)"; }
    [self add:@{@"kind":@"Bonjour",@"protocol":protocol,@"name":service.name,@"serviceType":service.type,@"addresses":addresses,@"host":host ?: service.hostName ?: @"",@"port":@(service.port),@"txt":txt,@"advertised":@YES,@"protocolConfirmed":@NO}];
    NSString *identity = [NSString stringWithFormat:@"%@ %@ %@",service.name,txt[@"fn"] ?: @"",txt[@"md"] ?: @""];
    BOOL target = [host isEqualToString:self.target] || [identity rangeOfString:@"Philips" options:NSCaseInsensitiveSearch].location != NSNotFound || [identity rangeOfString:@"AirServer" options:NSCaseInsensitiveSearch].location != NSNotFound || [identity containsString:@"55PUS8079"];
    if (!target || !host || service.port < 1 || service.port > 65535) return;
    if ([protocol isEqualToString:@"Google Cast"]) [self castHost:host port:service.port];
    if ([protocol isEqualToString:@"AirPlay"]) [self get:[NSURL URLWithString:[NSString stringWithFormat:@"http://%@:%ld/info",host,(long)service.port]] kind:@"AirPlay /info"];
    [self ssdpHost:host];
}
- (void)start:(NSString *)target update:(void (^)(NSArray *))update {
    self.update = update; self.target = target; self.stopped = NO;
    self.browsers = [NSMutableArray new]; self.services = [NSMutableArray new]; self.records = [NSMutableArray new]; self.queried = [NSMutableSet new]; self.casts = [NSMutableArray new]; self.udp = [NSMutableArray new]; self.bodies = [NSMutableDictionary new]; self.requests = [NSMutableDictionary new];
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration; configuration.waitsForConnectivity = NO; configuration.timeoutIntervalForRequest = 3; configuration.timeoutIntervalForResource = 4; configuration.HTTPShouldSetCookies = NO; configuration.HTTPCookieStorage = nil; configuration.URLCache = nil; configuration.connectionProxyDictionary = @{};
    self.http = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:NSOperationQueue.mainQueue];
    for (NSString *type in @[@"_airplay._tcp.",@"_raop._tcp.",@"_googlecast._tcp.",@"_dial._tcp."]) { NSNetServiceBrowser *browser = [NSNetServiceBrowser new]; browser.delegate = self; [self.browsers addObject:browser]; [browser searchForServicesOfType:type inDomain:@"local."]; }
    if (VWProbePrivateAddress(target)) {
        [self castHost:target port:8009]; [self ssdpHost:target];
        [self get:[NSURL URLWithString:[NSString stringWithFormat:@"http://%@:7000/info",target]] kind:@"AirPlay /info"];
        [self get:[NSURL URLWithString:[NSString stringWithFormat:@"http://%@:8008/ssdp/device-desc.xml",target]] kind:@"DIAL device description"];
    }
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ typeof(self) self = weakSelf; if (!self || self.stopped) return; [self add:@{@"kind":@"summary",@"note":@"Suche abgeschlossen. Ein angekündigter Dienst bestätigt noch keine Video- oder Live-Unterstützung. Keine Antwort ist kein Ausschluss. SSDP wurde gezielt per Unicast geprüft."}]; [self stop]; });
}
- (void)stop {
    if (self.stopped) return; self.stopped = YES;
    for (NSNetServiceBrowser *browser in self.browsers) { [browser stop]; browser.delegate = nil; }
    for (NSNetService *service in self.services) { [service stop]; service.delegate = nil; }
    for (VWReadOnlyCastProbe *probe in self.casts) [probe cancel];
    for (nw_connection_t connection in self.udp) { nw_connection_set_state_changed_handler(connection, nil); nw_connection_cancel(connection); }
    [self.http invalidateAndCancel]; self.http = nil; self.update = nil;
}
@end

@interface VWReceiverProbeController : UIViewController
@property(nonatomic, strong) VWReceiverProbe *probe;
@property(nonatomic, strong) UITextView *output;
@property(nonatomic, strong) UITextField *address;
@property(nonatomic, strong) UITextField *videoField;
@property(nonatomic, strong) NSArray *records;
@property(nonatomic, strong) VWReadOnlyCastProbe *launchProbe;
@end
@implementation VWReceiverProbeController
- (void)viewDidLoad {
    [super viewDidLoad]; self.title = @"AirServer prüfen"; self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@"Schließen" style:UIBarButtonItemStylePlain target:self action:@selector(close)];
    self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@"Ergebnis teilen" style:UIBarButtonItemStylePlain target:self action:@selector(share)];
    UILabel *hint = [UILabel new]; hint.numberOfLines = 0; hint.text = @"AirServer am Fernseher öffnen. TV-Adresse prüfen und „Prüfen“ antippen.";
    self.address = [UITextField new]; self.address.borderStyle = UITextBorderStyleRoundedRect; self.address.keyboardType = UIKeyboardTypeDecimalPad; self.address.placeholder = @"TV-IPv4-Adresse (optional)"; self.address.accessibilityLabel = @"TV-IPv4-Adresse"; self.address.text = [NSUserDefaults.standardUserDefaults stringForKey:@"VWProbeTVAddress"] ?: @"192.168.0.53";
    UIButton *start = [UIButton buttonWithType:UIButtonTypeSystem]; [start setTitle:@"Prüfen" forState:UIControlStateNormal]; [start addTarget:self action:@selector(run) forControlEvents:UIControlEventTouchUpInside];
    UIButton *launch = [UIButton buttonWithType:UIButtonTypeSystem];
    [launch setTitle:@"YouTube auf TV starten (Direkt-IP-Test)" forState:UIControlStateNormal];
    [launch addTarget:self action:@selector(launchYouTube) forControlEvents:UIControlEventTouchUpInside];
    self.videoField = [UITextField new]; self.videoField.borderStyle = UITextBorderStyleRoundedRect;
    self.videoField.placeholder = @"YouTube-Video-ID (11 Zeichen)";
    self.videoField.autocapitalizationType = UITextAutocapitalizationTypeNone;
    self.videoField.autocorrectionType = UITextAutocorrectionTypeNo;
    self.videoField.text = [NSUserDefaults.standardUserDefaults dictionaryForKey:@"VWLastYouTubeVideo"][@"id"];
    UIButton *video = [UIButton buttonWithType:UIButtonTypeSystem];
    [video setTitle:@"Video auf TV testen" forState:UIControlStateNormal];
    [video addTarget:self action:@selector(loadVideo) forControlEvents:UIControlEventTouchUpInside];
    self.output = [UITextView new]; self.output.editable = NO; self.output.font = [UIFont preferredFontForTextStyle:UIFontTextStyleBody]; self.output.text = @"Bereit. Die Prüfung startet keine TV-App und verändert keine Wiedergabe.";
    UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[hint,self.address,start,launch,self.videoField,video,self.output]]; stack.axis = UILayoutConstraintAxisVertical; stack.spacing = 12; stack.translatesAutoresizingMaskIntoConstraints = NO; [self.view addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[[stack.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor constant:16],[stack.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:16],[stack.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-16],[stack.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor constant:-16],[self.address.heightAnchor constraintEqualToConstant:44]]];
}
- (void)run {
    [self.address resignFirstResponder]; NSString *target = [self.address.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (target.length && !VWProbePrivateAddress(target)) { self.output.text = @"Bitte die lokale IPv4-Adresse des Fernsehers eingeben oder das Feld für die Bonjour-Suche leeren."; return; }
    [NSUserDefaults.standardUserDefaults setObject:target forKey:@"VWProbeTVAddress"];
    [self.probe stop]; self.probe = [VWReceiverProbe new]; self.records = @[]; self.output.text = @"Suche läuft …";
    __weak typeof(self) weakSelf = self;
    [self.probe start:target update:^(NSArray *records) {
        typeof(self) self = weakSelf; if (!self) return; self.records = records;
        NSMutableArray *lines = [NSMutableArray new];
        for (NSDictionary *record in records) {
            if ([record[@"kind"] isEqualToString:@"summary"]) { [lines addObject:record[@"note"]]; continue; }
            NSString *state = [record[@"protocolConfirmed"] boolValue] ? @"antwortet" : [record[@"advertised"] boolValue] ? @"angekündigt" : @"nicht bestätigt";
            [lines addObject:[NSString stringWithFormat:@"%@ · %@\n%@%@%@",record[@"protocol"] ?: record[@"kind"] ?: @"Dienst",state,record[@"name"] ?: record[@"host"] ?: @"",record[@"port"] ? [NSString stringWithFormat:@":%@",record[@"port"]] : @"",record[@"error"] ? [NSString stringWithFormat:@"\n%@",record[@"error"]] : @""]];
        }
        self.output.text = [lines componentsJoinedByString:@"\n\n"];
    }];
}
- (void)launchYouTube {
    NSString *host = [self.address.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!VWProbePrivateAddress(host)) { self.output.text = @"Bitte eine gültige lokale IPv4-Adresse eingeben."; return; }
    [self.launchProbe cancel];
    self.launchProbe = [VWReadOnlyCastProbe new];
    self.output.text = @"Direkte Cast-Verbindung wird aufgebaut; YouTube-Start wird angefordert …";
    __weak typeof(self) weakSelf = self;
    [self.launchProbe startHost:host port:8009 launch:YES completion:^(NSDictionary *result) {
        typeof(self) self = weakSelf; if (!self) return;
        BOOL running = [result[@"youtubeRunning"] boolValue];
        NSString *status = running ? @"YouTube-TV-App läuft laut Cast-Empfänger." : [result[@"launchError"] isKindOfClass:NSString.class] ? [NSString stringWithFormat:@"YouTube-Start abgelehnt: %@",result[@"launchError"]] : [result[@"launchCommandSent"] boolValue] ? @"Startbefehl gesendet, Ausführung nicht bestätigt." : @"Direkte Verbindung oder Start fehlgeschlagen.";
        self.output.text = [NSString stringWithFormat:@"%@\n\n%@",status,result];
        self.records = @[result];
    }];
}
- (void)loadVideo {
    NSString *host = [self.address.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSString *videoID = [self.videoField.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{11}$" options:0 error:nil];
    if (!VWProbePrivateAddress(host) || [pattern numberOfMatchesInString:videoID options:0 range:NSMakeRange(0,videoID.length)] != 1) {
        self.output.text = @"Gültige TV-IPv4-Adresse und 11-stellige YouTube-Video-ID erforderlich."; return;
    }
    [self.launchProbe cancel]; self.launchProbe = [VWReadOnlyCastProbe new];
    self.output.text = @"Video-Startbefehl wird an den YouTube-Cast-Empfänger gesendet …";
    __weak typeof(self) weakSelf = self;
    [self.launchProbe startHost:host videoID:videoID completion:^(NSDictionary *result) {
        typeof(self) self = weakSelf; if (!self) return;
        self.records = @[result];
        self.output.text = [NSString stringWithFormat:@"Videotest (noch kein bestätigter Stream)\n\n%@",result];
    }];
}
- (void)share {
    NSDictionary *report = @{@"version":@"0.3.3",@"capturedAt":[[NSISO8601DateFormatter new] stringFromDate:NSDate.date],@"mode":@"read-only",@"target":self.address.text ?: @"",@"records":self.records ?: @[],@"scanComplete":@(self.probe.stopped),@"liveStreamingTested":@NO};
    NSData *data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil]; if (!data) return;
    NSURL *url = [[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:@"VirtualWalking-AirServer-iPhone.json"]; if (![data writeToURL:url atomically:YES]) return;
    UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[url] applicationActivities:nil]; share.popoverPresentationController.barButtonItem = self.navigationItem.rightBarButtonItem; [self presentViewController:share animated:YES completion:nil];
}
- (void)close { [self.launchProbe cancel]; [self.probe stop]; [self dismissViewControllerAnimated:YES completion:nil]; }
- (void)viewDidDisappear:(BOOL)animated { [super viewDidDisappear:animated]; if (self.isBeingDismissed || self.navigationController.isBeingDismissed) { [self.launchProbe cancel]; [self.probe stop]; } }
@end
