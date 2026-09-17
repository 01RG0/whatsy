FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# nginx processes templates/*.template with envsubst at startup.
# NGINX_ENVSUBST_TEMPLATE_VARS limits substitution to BACKEND_URL only,
# so nginx's own $uri/$host/$remote_addr etc. are left untouched.
ENV NGINX_ENVSUBST_TEMPLATE_VARS=BACKEND_URL
EXPOSE 80
