#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include "../VirtualWalkingTV/VWProbeWire.h"
#include "probe-fixtures.h"
static int equals(VWProbeSlice slice, const char *text) { return slice.length == strlen(text) && !memcmp(slice.bytes,text,slice.length); }
int main(void) {
    VWProbeEnvelope envelope;
    assert(VWProbeDecode(VWProbeFixture0,sizeof(VWProbeFixture0),&envelope));
    assert(equals(envelope.source,"receiver-0"));
    assert(equals(envelope.nameSpace,"urn:x-cast:com.google.cast.receiver"));
    assert(envelope.payload.length > 127);
    assert(equals(envelope.payload,"{\"type\":\"RECEIVER_STATUS\",\"status\":{\"applications\":[{\"appId\":\"CC1AD845\",\"displayName\":\"Grüne Teststrecke\",\"transportId\":\"transport-1\",\"namespaces\":[{\"name\":\"urn:x-cast:com.google.cast.media\"}]}]}}"));
    unsigned char bytes[4096];
    size_t length=VWProbeEncode(bytes,sizeof(bytes),"receiver-0","urn:x-cast:com.google.cast.receiver","{\"type\":\"GET_STATUS\",\"requestId\":1}");
    assert(length==sizeof(VWProbeFixture1));assert(!memcmp(bytes,VWProbeFixture1,length));
    for(size_t capacity=0;capacity<length;capacity++) assert(!VWProbeEncode(bytes,capacity,"receiver-0","urn:x-cast:com.google.cast.receiver","{\"type\":\"GET_STATUS\",\"requestId\":1}"));
    for(size_t truncated=0;truncated<sizeof(VWProbeFixture0);truncated++) assert(!VWProbeDecode(VWProbeFixture0,truncated,&envelope));
    unsigned char malformed[]={0x32,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x7f};
    assert(!VWProbeDecode(malformed,sizeof(malformed),&envelope));
    srand(33);
    for(unsigned i=0;i<10000;i++) {
        length=(size_t)(rand()%sizeof(bytes));for(size_t j=0;j<length;j++)bytes[j]=(unsigned char)rand();
        if(VWProbeDecode(bytes,length,&envelope)) {
            assert(envelope.payload.bytes>=bytes && envelope.payload.bytes+envelope.payload.length<=bytes+length);
            assert(envelope.nameSpace.bytes>=bytes && envelope.nameSpace.bytes+envelope.nameSpace.length<=bytes+length);
        }
    }
    puts("PASS: independent Chromium protobuf fixtures, UTF-8, multi-byte lengths, truncated/corrupt packets, encoding capacity bounds, 10,000 fuzz cases.");
    return 0;
}
