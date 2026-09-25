declare module "*.svg";
declare module "*.png";
declare module "*.jpg" {
	const src: string;
	export default src;
}
declare module "*.css";
