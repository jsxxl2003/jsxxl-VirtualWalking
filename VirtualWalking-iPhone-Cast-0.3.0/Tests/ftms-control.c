#include "../VirtualWalkingTV/VWFTMSControl.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
    uint8_t features[] = {0,0,0,0,1,0,0,0}, limits[] = {50,0,88,2,10,0};
    uint8_t target[] = {2,210,0}, start[] = {7}, stop[] = {8,1}, unknown[] = {1};
    assert(VWFTMSCommandAllowed(start,1,NULL,0,NULL,0));
    assert(VWFTMSCommandAllowed(stop,2,NULL,0,NULL,0));
    assert(!VWFTMSCommandAllowed(unknown,1,features,8,limits,6));
    assert(!VWFTMSCommandAllowed(target,3,NULL,0,limits,6));
    assert(!VWFTMSCommandAllowed(target,3,features,8,NULL,0));
    assert(VWFTMSCommandAllowed(target,3,features,8,limits,6));
    target[1]=205; assert(!VWFTMSCommandAllowed(target,3,features,8,limits,6));
    target[1]=50; assert(VWFTMSCommandAllowed(target,3,features,8,limits,6));
    target[1]=88; target[2]=2; assert(VWFTMSCommandAllowed(target,3,features,8,limits,6));
    target[1]=98; assert(!VWFTMSCommandAllowed(target,3,features,8,limits,6));
    target[1]=0; target[2]=0; limits[0]=0; assert(!VWFTMSCommandAllowed(target,3,features,8,limits,6));
    limits[4]=0; assert(!VWFTMSCommandAllowed(target,3,features,8,limits,6));
    assert(!VWFTMSCommandAllowed(target,2,features,8,limits,6));
    assert(!VWFTMSCommandAllowed(NULL,0,features,8,limits,6));
    puts("PASS: native FTMS target boundaries and command allowlist");
}
