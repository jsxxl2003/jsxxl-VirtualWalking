#ifndef VW_RECEIVER_ADDRESS_H
#define VW_RECEIVER_ADDRESS_H
#include <arpa/inet.h>
#include <ctype.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char host[INET_ADDRSTRLEN]; unsigned port; } VWReceiverAddress;

// Accept the address displayed by our receiver, or a bare IPv4 address.
// Credentials, paths and query strings never belong in the stored base address.
static inline bool VWParseReceiverAddress(const char *input, VWReceiverAddress *result) {
    if (!input || !result) return false;
    while (isspace((unsigned char)*input)) input++;
    size_t length = strlen(input);
    while (length && isspace((unsigned char)input[length - 1])) length--;
    if (!length || length >= 96) return false;
    char text[96]; memcpy(text, input, length); text[length] = '\0';
    char *host = text;
    if (strncmp(host, "http://", 7) == 0) host += 7;
    size_t hostLength = strlen(host);
    if (hostLength && host[hostLength - 1] == '/') host[--hostLength] = '\0';
    unsigned port = 8765;
    char *separator = strchr(host, ':');
    if (separator) {
        *separator++ = '\0'; size_t digits = strlen(separator);
        if (!digits || digits > 5) return false;
        for (size_t i = 0; i < digits; i++) if (!isdigit((unsigned char)separator[i])) return false;
        unsigned long value = strtoul(separator, NULL, 10);
        if (value < 1 || value > 65535) return false;
        port = (unsigned)value;
    }
    struct in_addr address;
    if (strlen(host) >= INET_ADDRSTRLEN || inet_pton(AF_INET, host, &address) != 1) return false;
    strcpy(result->host, host); result->port = port; return true;
}
#endif
