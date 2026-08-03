import ssl, socket

hostname = 'smarta-api.smarta-api.workers.dev'
ctx = ssl.create_default_context()
conn = ctx.wrap_socket(socket.create_connection((hostname, 443)), server_hostname=hostname)
cert_der = conn.getpeercert(binary_form=True)
conn.close()
pem = ssl.DER_cert_to_PEM_cert(cert_der)
with open('leaf.pem', 'w') as f:
    f.write(pem)
print('OK - leaf.pem saved')
