#include <assert.h>
#include <stdio.h>
#include "../VirtualWalkingTV/VWReceiverAddress.h"
int main(void) {
    VWReceiverAddress address;
    const char *valid[] = {"http://192.168.0.119:8765", "192.168.0.119", "192.168.0.119:8765", "  http://192.168.0.119:8765/\n"};
    for (size_t i = 0; i < sizeof(valid) / sizeof(valid[0]); i++) {
        assert(VWParseReceiverAddress(valid[i], &address));
        assert(strcmp(address.host, "192.168.0.119") == 0); assert(address.port == 8765);
    }
    assert(VWParseReceiverAddress("192.168.0.32:8080", &address));
    assert(strcmp(address.host, "192.168.0.32") == 0); assert(address.port == 8080);
    const char *invalid[] = {"", "192.168.0.999", "192.168.0", "192.168.0.119:", "192.168.0.119:0", "192.168.0.119:65536", "192.168.0.119:8765junk", "192.168.0.119:-1", "192.168.0.119:8765/status", "192.168.0.119:8765?key=private", "192.168.0.119#fragment", "user:password@192.168.0.119", "https://192.168.0.119:8765", "file:///etc/passwd", "192.168.0.119:8765//", "192.168.0.119:999999999999999999999", "<script>"};
    for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); i++) assert(!VWParseReceiverAddress(invalid[i], &address));
    assert(!VWParseReceiverAddress(NULL, &address)); assert(!VWParseReceiverAddress("192.168.0.119", NULL));
    puts("PASS: receiver IPv4 address, changed DHCP address, port and malformed input");
    return 0;
}
