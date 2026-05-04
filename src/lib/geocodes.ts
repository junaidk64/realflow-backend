import axios from 'axios'
import dotenv from 'dotenv'
import {
	IGeocode,
	IRadarAddressFromCoordsResponse,
} from '../Interfaces/IGeocodes'
import { IListing } from '../models/Listing'
dotenv.config()
class GeocodeService {
	private environments = {
		GEOCODE_API_KEY: process.env.GEOCODE_API_KEY || '',
		RADAR_SERVER_KEY: process.env.RADAR_SERVER_KEY || '',
	}
	public async prediction(
		input: string,
		radius?: number,
		lat?: number,
		lng?: number,
	) {
		const _host = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${input}&key=${this.environments.GEOCODE_API_KEY}&location=${lat}%2C${lng}&radius=${radius}&limit=5`
		const response = await axios.get(_host)

		if (
			response.data['status'] === 'OK' ||
			response.data['status'] === 'ZERO_RESULTS'
		) {
			const predictions = response.data['predictions']
			return predictions
		}
		throw new Error(response.data)
	}

	public async autocompleteDetails(placeId: string) {
		const _host = 'https://maps.googleapis.com/maps/api/place/details/json'

		const params = {
			place_id: placeId,
			fields: 'geometry,formatted_address,address_components',
			key: this.environments.GEOCODE_API_KEY,
		}

		const response = await axios.get(_host, { params })

		if (response.data['status'] === 'OK') {
			const results = response.data['result']

			const addressComponents: IGeocode.AddressComponent[] =
				results['address_components']
			const formatedAddress: string = results['formatted_address']
			const geometryRes: any = results['geometry']
			const coordinates: [number, number] = [
				Number(geometryRes['location']['lng']),
				Number(geometryRes['location']['lat']),
			]

			const address: IListing['address'] = {
				//placeId: placeId as string,
				street: formatedAddress,
				latitude: coordinates[1],
				longitude: coordinates[0],
				country: addressComponents.filter((e) => e.types.includes('country'))[0]
					?.long_name,
				// isoCode: addressComponents.filter((e) => e.types.includes('country'))[0]
				// 	.short_name,
				type: 'Point',
				coordinates: coordinates,
				state: addressComponents.filter((e) =>
					e.types.includes('administrative_area_level_1'),
				)[0]?.long_name,
				city: this._cityFromComponents(addressComponents),
			}

			return address
		}
		throw new Error(response.data)
	}

	private _cityFromComponents(components: IGeocode.AddressComponent[]) {
		const locality = components.filter((e) => e.types.includes('locality'))[0]
			?.long_name

		const administrative_area_level_2 = components.filter((e) =>
			e.types.includes('administrative_area_level_2'),
		)[0]?.short_name

		const sublocality_level_1 = components.filter((e) =>
			e.types.includes('sublocality_level_1'),
		)[0]?.long_name

		const route = components.filter((e) => e.types.includes('route'))[0]
			?.long_name

		return (
			locality ?? sublocality_level_1 ?? administrative_area_level_2 ?? route
		)
	}

	async direction(
		from: {
			latitude: number
			longitude: number
		},
		to: {
			latitude: number
			longitude: number
		},
	) {
		const _host = 'https://maps.googleapis.com/maps/api/directions/json?'

		const queryParameters = {
			origin: `${from.latitude},${from.longitude}`,
			destination: `${to.latitude},${to.longitude}`,
			key: this.environments.GEOCODE_API_KEY,
		}

		const response = await axios.get(_host, { params: queryParameters })

		if (response.data['status'] === 'OK') {
			return response.data as IGeocode.Direction
		}

		if (response.data['status'] === 'NOT_FOUND') {
			throw new Error('Route between points not found')
		}

		throw new Error(response.data)
	}

	private async geoAddressFromCoords(latitude: number, longitude: number) {
		const _host = 'https://maps.google.com/maps/api/geocode/json'

		const response = await axios.get(_host, {
			params: {
				key: this.environments.GEOCODE_API_KEY,
				latlng: `${latitude},${longitude}`,
			},
		})

		if (response.data['status'] === 'OK') {
			const results = response.data['results'][0]

			const addressComponents: IGeocode.AddressComponent[] =
				results['address_components']

			const formatedAddress = results['formatted_address']

			const placeId = results['place_id']

			const geometryRes: any = results['geometry']

			const address: IListing['address'] = {
				// placeId,
				street: formatedAddress,
				latitude: Number(geometryRes['location']['lat']),
				longitude: Number(geometryRes['location']['lng']),
				country: addressComponents.filter((e) => e.types.includes('country'))[0]
					?.long_name,
				// isoCode: addressComponents.filter((e) => e.types.includes('country'))[0]
				// 	?.short_name,
				state: addressComponents.filter((e) =>
					e.types.includes('administrative_area_level_1'),
				)[0]?.long_name,
				city: this._cityFromComponents(addressComponents),
				type: 'Point',
				coordinates: [
					Number(geometryRes['location']['lng']),
					Number(geometryRes['location']['lat']),
				],
			}

			return address
		}
		throw new Error(response.data)
	}

	/**
	 * @param lat  number Latitude of the location to geocode
	 * @param lng  number Longitude of the location to geocode
	 * @returns  RadarGeocodeResponse
	 * @description Geocodes a latitude and longitude to a human-readable address.
	 */
	public async addressFromCoords(
		lat: number,
		lng: number,
	): Promise<IListing['address']> {
		try {
			const url = `https://api.radar.io/v1/geocode/reverse?coordinates=${lat},${lng}`
			const response = await axios.get(url, {
				headers: { Authorization: this.environments.RADAR_SERVER_KEY },
			})
			const data =
				response.data as IRadarAddressFromCoordsResponse.RadarGeocodeResponse

			if (data.meta.code === 200 && data.addresses.length > 0) {
				const address: IListing['address'] = {
					city:
						(data.addresses[0].county || data.addresses[0].city) ?? 'Unknown',
					country: data.addresses[0].country,
					state:
						data.addresses[0].state !== undefined
							? data.addresses[0].state
							: 'Unknown',
					street:
						data.addresses[0].placeLabel ??
						data.addresses[0].addressLabel ??
						data.addresses[0].formattedAddress,
					latitude: lat,
					longitude: lng,
					coordinates: [lng, lat],
					// isoCode: data.addresses[0].countryCode,
					type: 'Point',
				}

				return address
			}

			/*
			 * IF the Radar API fails, use the @GoogleAPI
			 */
			const address = await this.geoAddressFromCoords(lat, lng)
			return address
		} catch (e) {
			const address = await this.geoAddressFromCoords(lat, lng)
			return address
		}
	}
}

export default new GeocodeService()
